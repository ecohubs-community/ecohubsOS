# Implementation Spec: Internal Voting System

- **Status:** Draft
- **Companion to:** [voting-system.md](voting-system.md)
- **Date:** 2026-05-01

> Tech-level breakdown of how to implement the voting-system spec. Organised into phases that can land as separate PRs. Each task ends with a one-line rationale.

Each phase is intended to be merge-able and leaves the system in a working state.

---

## Phase 0 — Foundations

Goal: schema + server primitives in place, no UI yet.

### 0.1 Add `proposals` and `proposal_votes` tables to `src/lib/server/db/schema.ts`

- `proposals`: `id` (uuid pk), `type` (`operational` | `strategic` | `constitutional`), `title`, `body`, `authorUserId` (text, nullable, FK→user), `tags` (text JSON, max 5 entries enforced in code), `choiceSetKey` (text — registry key), `choices` (text JSON snapshot), `threshold` (`majority` | `supermajority`), `createdAt`, `voteOpensAt`, `voteClosesAt`, `ratificationEndsAt` (nullable), `status` (`deliberating` | `active` | `closed` | `ratifying` | `ratified` | `withdrawn`), `result` (`approved` | `rejected` | `needs_review` | `tied` | nullable), `discordNotifiedTransitions` (text JSON array of status names — for idempotency, default `'[]'`), `linkedApplicationId` (nullable, **unique**, FK→applications), `linkedBlogDraftId` (nullable, **unique**, text). Add `votingLogger = logger.child({ module: 'voting' })` in the same change.
- `proposal_votes`: `id`, `proposalId` (FK→proposals, cascade), `userId` (FK→user), `choice` (text), `reason` (text, nullable), `votedAt`. **Unique index** on `(proposalId, userId)` (constraint + perf index).
- *Rationale:* `withdrawn` reserved + linked-id uniqueness + notification-idempotency column avoid follow-up migrations; one source-of-truth log channel for voting; choice snapshot keeps history intact when registry evolves.

### 0.2 Run `pnpm db:push` and commit the generated migration in `drizzle/`

- *Rationale:* keeps SQLite, Drizzle metadata, and source schema in lock-step before any code reads from the new tables.

### 0.3 Choice-set registry at `src/lib/server/voting/choice-sets.ts`

- `export const CHOICE_SETS = { default: ['For', 'Against', 'Needs Review'], membership: ['Approve', 'Reject', 'Needs Review'], blog: ['Publish', 'Reject', 'Needs Revision'] } as const;`
- Helper `getChoices(key)` with type-safe lookup.
- *Rationale:* code-only registry means adding a future set is a one-file change with no migration.

### 0.4 Type/period config at `src/lib/server/voting/types.ts`

- Map of `type → { deliberationDays, voteDays, threshold, ratificationDays }` matching voting-system.md §3.5.
- Pure helper `computePeriods(type, now)` → `{ voteOpensAt, voteClosesAt, ratificationEndsAt }`.
- *Rationale:* single source of truth for governance periods; tested in isolation.

### 0.5 Pure result-resolver at `src/lib/server/voting/resolve.ts`

- `resolveResult(voteTallies, choices, threshold) → 'approved' | 'rejected' | 'needs_review' | 'tied'` implementing the 3-choice mapping rules in voting-system.md §3.4 (first-choice meets threshold → approved; otherwise runner-up between Choice[1] and Choice[2] decides; equal runner-ups → tied; zero votes → rejected).
- *Rationale:* the resolver is the single function that decides outcomes; centralised + unit-tested = governance-grade.

---

## Phase 1 — API surface

Goal: full proposal CRUD + voting endpoints, callable but not yet wired into UI.

### 1.1 Move existing Snapshot-update endpoint out of the way

- The current [api/proposals/+server.ts](src/routes/api/proposals/+server.ts) handles Snapshot-update calls from `MembershipManager`. Rename to `src/routes/api/applications/[id]/snapshot-proposal/+server.ts` and update the one client call site to match. Mark as deprecated in a code comment.
- *Rationale:* avoids a route-shape collision when the new `/api/proposals` surface lands. The renamed endpoint is removed entirely in Phase 5.

### 1.2 `GET /api/proposals` at `src/routes/api/proposals/+server.ts`

- Auth-gated (any authenticated user). Query params: `?status=active|past|all`, `?type=...`, `?tag=...`, `?unvoted=1`. Calls `materialiseAllStale()` (1.7) before reading. Returns proposals with `votes_total`, `votes_by_choice`, and `userHasVoted` for the caller. Tag filter uses SQLite `json_each` (json1 extension is on by default in `better-sqlite3`).
- *Rationale:* single list endpoint serves UI + badge; pre-computed counts avoid N+1; lazy materialisation guarantees fresh status without a cron.

### 1.3 `POST /api/proposals`

- Body: `{ type, title, body, tags? }`. Validates: server-side Offcoin level ≥ 3 (look up via `puckstackUserId` on the user row → `offcoin.members.getXp(...)`), title ≤ 140, body ≤ 10 000, type enum, tags ≤ 5 (normalised to lower-kebab-case). Computes periods via `computePeriods`. Inserts with `status='deliberating'` (or `active` when `deliberationDays === 0`). Snapshots `choices` from `CHOICE_SETS.default`. Sends Discord `proposalCreatedMessage`.
- *Rationale:* server is the only authoritative eligibility gate; choices snapshotted so future registry changes don't rewrite history.

### 1.4 `GET /api/proposals/[id]` at `src/routes/api/proposals/[id]/+server.ts`

- Returns proposal + voter list (`userId`, `displayName` || `name`, `choice`, `reason`, `votedAt`) + tally. Never returns email or wallet address.
- *Rationale:* detail page needs voter list per spec; identity projection prevents accidental PII leak.

### 1.5 `POST /api/proposals/[id]/vote`

- Body: `{ choice, reason? }`. Validates: caller is authenticated, proposal `status === 'active'`, `choice` in `proposal.choices`, `reason` ≤ 1 000. DB unique constraint is the race-condition safety net.
- *Rationale:* keeping the gate at "authenticated" only — no Offcoin / wallet dependency — means anyone who has logged in via SSO can vote. The status check + unique index together close the double-vote and out-of-window race.

### 1.6 `GET /api/proposals/tags`

- Returns distinct tags + usage counts. Used by the proposal form for autocomplete.
- *Rationale:* keeps the tag vocabulary from fragmenting without imposing a fixed taxonomy.

### 1.7 Status materialiser at `src/lib/server/voting/materialise.ts`

- `materialiseProposal(p, now)` advances `deliberating → active → closed → ratifying → ratified` based on timestamps; writes new `status`/`result` if changed. On each transition that maps to a Discord template, push the status into `discordNotifiedTransitions` and fire the message *only if not already present* (idempotent).
- `materialiseAllStale()` runs an indexed scan for proposals whose timestamps imply a pending transition; called from every `GET /api/proposals*` request.
- *Rationale:* lazy materialiser avoids cron infra; idempotency column kills duplicate Discord pings even under concurrent calls.

### 1.8 Tests for Phase 0/1

- Unit: `computePeriods` (all three types), `resolveResult` covering each example in voting-system.md §3.4 plus zero-vote and tied edge cases, `materialiseProposal` walking each transition, idempotency check on Discord notifications.
- Integration: vote uniqueness under concurrent POSTs, level gate, voter-eligibility gate, status gate, tag-filter query.
- *Rationale:* state machine + resolver + idempotency are the riskiest surfaces; lock them with tests before any UI lands.

---

## Phase 2 — Voting app UI

Goal: members can read, vote, and create proposals.

### 2.1 New app folder `src/lib/apps/voting/`

- `Voting.svelte` (root), `ProposalList.svelte`, `ProposalDetail.svelte`, `ProposalForm.svelte`, `VoteModal.svelte`, `MarkdownEditor.svelte`, `MarkdownView.svelte`, plus `favicon.svg`.
- *Rationale:* matches the layout of existing internal apps (`blog-manager`, `membership-manager`), so navigation, window chrome, and styling fall through.

### 2.2 Register the app in `src/lib/data.ts`

- Replace the existing `snapshot` entry with `id: 'voting'`, `isInternalApp: true`, `category: 'governance'`, `icon: VotingFavicon`, component `Voting`.
- *Rationale:* keeps the dock slot the user already expects; old `snapshot` external link disappears in the same change.

### 2.3 Proposal list view (`ProposalList.svelte`)

- Tabs: Active / Past. Filter chips: type + tag. Cards: title, excerpt, type badge, tag chips, end-date countdown, vote count, "voted" indicator.
- "New Proposal" button — only rendered if `offcoin.level >= 3`.
- *Rationale:* spec §3.1 surface; offcoin level is already client-available so no extra fetch.

### 2.4 Proposal detail view (`ProposalDetail.svelte`)

- Renders title, type, tags, periods, markdown body via `MarkdownView`. Voting widget enabled only when `status === 'active'` and `userHasVoted === false`. Voter list always visible (per spec, both during and after).
- *Rationale:* one component handles all states (deliberating / active / closed / ratifying / ratified); state-specific messages keep users oriented.

### 2.5 Vote modal (`VoteModal.svelte`)

- Triggered by clicking a choice button. Shows the chosen option, a textarea for the optional reason (max 1 000, with counter), Cancel + Confirm. Submits to `POST /api/proposals/[id]/vote`.
- *Rationale:* spec §3.2 — gives the user a chance to back out and adds qualitative value to the voter list.

### 2.6 Markdown editor + view

- `MarkdownEditor.svelte`: plain textarea + side-by-side live preview pane. **No toolbar in v1** — markdown is the format, no WYSIWYG.
- `MarkdownView.svelte`: renders sanitised HTML via `marked` + `dompurify`.
- Add `marked` + `dompurify` to dependencies.
- *Rationale:* "simple markdown editor" means simple — a toolbar adds significant code surface for marginal UX gain. Sanitisation, however, is non-negotiable.

### 2.7 Proposal form (`ProposalForm.svelte`)

- Type select, title input (140-char counter), markdown editor (10 000-char counter), tag chip input (max 5, autocomplete from §1.6). Submits to `POST /api/proposals`. Hidden if `offcoin.level < 3` (server is the authoritative gate regardless).
- *Rationale:* matches spec §3.3; counters prevent first-attempt 400s from char-limit overruns.

---

## Phase 3 — Badge + integration with existing apps

Goal: red badge on the voting app + auto-creation flows for membership and blog.

### 3.1 Extend `src/lib/badges.svelte.ts`

- Add `voting: number` to `BadgeCounts`. Refresh fetches `GET /api/proposals?status=active&unvoted=1` and counts results. (Filter is already implemented in §1.2.)
- *Rationale:* same pattern as the other two badged apps; one extra fetch on auth, no new endpoint.

### 3.2 `createSystemProposal` helper at `src/lib/server/voting/system-proposal.ts`

- Shared helper used by application + blog hooks: takes `{ type, choiceSetKey, tags, title, body, linkedApplicationId?, linkedBlogDraftId? }`, computes periods, snapshots choices, inserts the proposal, fires Discord. Idempotent on linked-id (returns the existing proposal if one already exists).
- *Rationale:* one helper for both auto-creation paths; idempotency closes the door on duplicate proposals from request retries.

### 3.3 Auto-create membership proposal in `POST /api/applications` ([+server.ts](src/routes/api/applications/+server.ts))

- After insert, call `createSystemProposal({ type: 'operational', choiceSetKey: 'membership', tags: ['membership', 'system'], title: 'Membership Application: <fullName>', body: formatApplicationBody(application), linkedApplicationId })`.
- *Rationale:* removes the manual admin step; spec §6.3.

### 3.3a One-shot backfill for in-flight applications

- Migration script (run once) that finds applications with `status = 'pending'` and no linked proposal, and creates a proposal for each via `createSystemProposal`.
- *Rationale:* without this, applications already in the database when Phase 3 ships would never get a proposal and would stall in the admin UI.

### 3.4 Replace Snapshot status enrichment in `GET /api/applications`

- Drop `getProposalStatus` / `getMembershipVotingResult` calls; instead join (or batch-fetch) the linked proposals and project equivalent fields (`votingStatus`, `votingResult`, `votingEnd`, `votingScores`).
- *Rationale:* preserves the `MembershipManager` UI contract while moving the source of truth to the local DB.

### 3.5 Remove "Create Snapshot Proposal" UI in `MembershipManager.svelte`

- Delete `createProposal` and the button. Add a link to the local proposal page instead.
- *Rationale:* admin no longer needs to do anything; surface the proposal id for context.

### 3.6 Auto-create blog proposal

- In the existing draft-publish flow ([api/blog/drafts/[id]/update-proposal/+server.ts](src/routes/api/blog/drafts/[id]/update-proposal/+server.ts)), replace the Snapshot creation with `createSystemProposal({ type: 'operational', choiceSetKey: 'blog', tags: ['blog', 'system'], ..., linkedBlogDraftId })`.
- Update `BlogManager.svelte` to read status from the local proposal instead of `getProposalForDraft`.
- One-shot backfill: for every blog draft currently linked to a Snapshot proposal, create a local proposal mirroring its remaining lifecycle.
- *Rationale:* spec §6.4; backfill keeps in-flight blog publication votes from disappearing on cutover.

### 3.7 Discord templates ([discord-templates.ts](src/lib/server/discord-templates.ts))

- Update `proposalCreatedMessage` to drop the link argument.
- Add `proposalClosedApproved`, `proposalClosedRejected`, `proposalNeedsReview`, `proposalRatified` (all link-free).
- Wired in §1.7 with the idempotency check via `discordNotifiedTransitions`.
- *Rationale:* spec §6.6; idempotency-aware materialiser means we don't need a separate scheduler.

---

## Phase 4 — Onboarding + Wallet/Safe demotion

Goal: onboarding no longer mentions Snapshot or Wallet/Safe; those apps remain accessible.

### 4.1 Edit [stepManager.ts](src/lib/onboarding/stepManager.ts)

- Remove the `snapshot` step entirely.
- Remove the `wallet-safe` step from the default sequence.
- *Rationale:* spec §6.1 + §6.2; no more dead onboarding pointing at the deprecated Snapshot space.

### 4.2 Make wallet/safe apps user-visible

- In [data.ts](src/lib/data.ts): un-hide `safe-proposal` (rename to "Safe Membership"), keep it as `category: 'system'`. Group `wallet-setup` + `wallet-connect` either as a single combined system app or keep both and unhide.
- *Rationale:* opt-in path for users who want governance / treasury power later.

### 4.3 Existing-user data migration

- One-shot script (or `onboarding.ts` adapter) that marks the now-removed substeps as completed for users who already had them in `onboardingProgress`, so progress UI stays at 100% rather than regressing.
- *Rationale:* avoid breaking the onboarding-completion state for everyone with progress already saved.

---

## Phase 5 — Snapshot decommission

Goal: remove the Snapshot dependency surface entirely.

### 5.1 Delete `src/lib/server/blog-snapshot.ts`

- *Rationale:* no remaining call sites after Phase 3.

### 5.2 Remove `@snapshot-labs/snapshot.js` from `package.json` + `pnpm-lock.yaml`

- *Rationale:* drops a sizeable client-side bundle once the membership/blog flows stop importing it.

### 5.3 Remove `SNAPSHOT_SPACE`, `SNAPSHOT_VOTING_DURATION` env vars + docs

- *Rationale:* prevents stale config drift; reduces deploy footprint.

### 5.4 Drop `snapshotProposalId` / `snapshotProposalLink` from `applications` schema (deferred column drop)

- After one release cycle confirms the new flow is stable, write a follow-up migration that drops the unused columns. Until then, keep them nullable.
- *Rationale:* lets us roll back to Snapshot without a schema rebuild during the bedding-in window.

### 5.5 (Optional) Historical Snapshot import

- One-shot script: query Snapshot GraphQL for closed proposals in the space, insert into `proposals` with `status='ratified'`/`'closed'`, author = "Snapshot Import", a single aggregate `proposal_votes` row per choice (or skip individual votes).
- Run once, manually, on production after Phase 5.4.
- *Rationale:* listed as nice-to-have in voting-system.md §10; isolates risk by being last and one-off.

---

## Phase 6 — RCOS docs

Goal: governance docs reflect the new mechanism.

### 6.1 Edit `RCOS-ecohubs/layers/2-governance/01-decision-matrix.md`

- Replace "Snapshot vote" with "ecohubsOS internal vote" in the Mechanism column. Update Voting Principles.
- *Rationale:* matrix is the canonical authority; if it still says Snapshot, every internal vote is technically out-of-process.

### 6.2 Edit `RCOS-ecohubs/layers/2-governance/02-governance-protocol.md`

- Replace Snapshot references in Submission, Deliberation, Execution, Appeal sections.
- *Rationale:* protocol must point at the actual tooling members will use.

### 6.3 Update Ratification Records

- Mark these doc changes as Constitutional, version-bump.
- *Rationale:* paper-trail; once the protocol is formally adopted later, this entry is the historical record.

---

## Phase 7 — Hardening & rollout

### 7.1 Markdown sanitisation review

- Run `dompurify` with strict config; allow only common formatting tags + links with `rel="noopener noreferrer"`. Add a unit test rendering a known-bad payload.
- *Rationale:* member-submitted markdown is the most likely XSS vector in the app.

### 7.2 Rate-limit `POST /api/proposals` and `POST /api/proposals/[id]/vote`

- Re-use the in-memory rate-limit map pattern from `applications/+server.ts` (or extract to a shared util while we are here).
- *Rationale:* prevents accidental or hostile flooding of the proposal table.

### 7.3 Audit log

- On vote submission and proposal creation, write a structured `votingLogger.info` entry with proposalId, userId, action.
- *Rationale:* governance actions need traceability for any later dispute.

### 7.4 End-to-end test (Playwright)

- Happy path: level-3 user creates a Strategic proposal → second user votes "For" with a reason → vote-close materialiser flips status → result resolves to approved → badge clears for the second user.
- *Rationale:* one end-to-end test catches regressions across the schema → API → UI → badge chain.

### 7.5 Pre-release checklist

- Verify `pnpm check` passes (mind the four pre-existing `vite.config.ts` errors per CLAUDE.md).
- Verify badge counts after fresh login.
- Verify Discord notifications fire on each transition.
- *Rationale:* explicit checklist makes the cutover deliberate and reviewable.

---

## Risks / things to watch

- **Lazy materialiser drift:** if no traffic hits the API, transitions stall. Acceptable for low-traffic v1; revisit with a real cron if the badge / Discord pings start lagging visibly.
- **Markdown XSS:** sanitisation regressions are silent and dangerous — keep §7.1's test in CI.
- **Endpoint rename in §1.1:** the renamed Snapshot-update route must ship in the same PR as the client call-site change to avoid a broken `MembershipManager`.
- **Backfill timing:** §3.3a / §3.6 backfills must run **after** the new schema is live and **before** users hit the new flows.
- **Rollback:** Snapshot columns on `applications` stay nullable indefinitely (§5.4 deferred — no real cost, gives an out).
- **Constitutional ratification timer:** edge case if a passed Constitutional proposal is invalidated mid-ratification — out of scope here; document the manual override path.

## Phase ordering / merge dependencies

- 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Each phase leaves the system functional at its boundary; mid-phase commits may not.
- Within Phase 1: §1.1 (endpoint rename) **must merge first** to clear the route shape.
- Phase 3 must merge **after** Phase 1 and **before** Phase 5 (decommission).
- Phase 5.5 (historical Snapshot import) is independent and can be deferred indefinitely.
