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

- `proposals`: `id` (uuid pk), `type` (`operational` | `strategic` | `constitutional`), `title` (text), `body` (text), `authorUserId` (text, nullable, FK→user), `tags` (text JSON), `choiceSetKey` (text — registry key), `choices` (text JSON snapshot), `threshold` (`majority` | `supermajority`), `createdAt`, `voteOpensAt`, `voteClosesAt`, `ratificationEndsAt` (nullable), `status` (`deliberating` | `active` | `closed` | `ratifying` | `ratified`), `result` (`approved` | `rejected` | `needs_review` | `tied` | nullable), `linkedApplicationId` (nullable, FK→applications), `linkedBlogDraftId` (nullable, text).
- `proposal_votes`: `id`, `proposalId` (FK→proposals, cascade), `userId` (FK→user), `choice` (text), `reason` (text, nullable), `votedAt`. Unique index on `(proposalId, userId)`.
- *Rationale:* one schema migration up front avoids re-migrating mid-feature; the `choiceSetKey` + `choices` snapshot lets us evolve the registry without rewriting historical proposals.

### 0.2 Run `pnpm db:push` and commit the generated migration in `drizzle/`

- *Rationale:* keeps SQLite, Drizzle metadata, and source schema in lock-step before any code reads from the new tables.

### 0.3 Choice-set registry at `src/lib/server/voting/choice-sets.ts`

- `export const CHOICE_SETS = { default: ['For', 'Against', 'Needs Review'], membership: ['Approve', 'Reject', 'Needs Review'], blog: ['Publish', 'Reject', 'Needs Revision'] } as const;`
- Helper `getChoices(key)` with type-safe lookup.
- *Rationale:* code-only registry means adding a future set is a one-file change with no migration.

### 0.4 Type/period config at `src/lib/server/voting/types.ts`

- Map of `type → { deliberationDays, voteDays, threshold, ratificationDays }` matching the locked table in voting-system.md §3.5.
- Pure helper `computePeriods(type, now)` returns `{ voteOpensAt, voteClosesAt, ratificationEndsAt }`.
- *Rationale:* one source of truth for governance periods; tested in isolation.

### 0.5 Pure result-resolver at `src/lib/server/voting/resolve.ts`

- `resolveResult(votes, choices, threshold) → 'approved' | 'rejected' | 'needs_review' | 'tied'` returning the winning choice mapped to the canonical result, with explicit tie semantics.
- *Rationale:* the single function that decides outcomes is unit-testable and reusable across the close job, status enrichers, and any backfill.

### 0.6 Server logger child at `src/lib/server/logger.ts`

- Add `votingLogger = logger.child({ module: 'voting' })`.
- *Rationale:* keeps voting telemetry filterable, matching existing module conventions.

---

## Phase 1 — API surface

Goal: full proposal CRUD + voting endpoints, callable but not yet wired into UI.

### 1.1 `GET /api/proposals` at `src/routes/api/proposals/+server.ts`

- Replace the current Snapshot-update endpoint logic. Auth-gated. Query params: `?status=active|past`, `?type=...`, `?tag=...`. Returns proposals with computed counts (`votes_total`, `votes_by_choice`) and `userHasVoted` for the caller.
- *Rationale:* one list endpoint serves both the proposals UI and the badge store; pre-computed counts avoid N+1 on the list view.

### 1.2 `POST /api/proposals`

- Body: `{ type, title, body, tags? }`. Validates: Offcoin level ≥ 3 (server-side fetch), char limits (140/10 000), type enum, tag normalisation. Computes periods via `computePeriods`. Inserts proposal with `status='deliberating'` (or `active` if `deliberationDays === 0`).
- *Rationale:* server-side eligibility check is mandatory — UI gating is a UX nicety, not a security boundary.

### 1.3 `GET /api/proposals/[id]` at `src/routes/api/proposals/[id]/+server.ts`

- Returns proposal + vote list (userId, displayName, choice, reason, votedAt) + tally.
- *Rationale:* detail page needs the full voter list per spec; one query keeps the page fast.

### 1.4 `POST /api/proposals/[id]/vote`

- Body: `{ choice, reason? }`. Validates: proposal `status === 'active'`, choice in `proposal.choices`, reason ≤ 1 000 chars, no existing vote for this user (DB unique constraint as the safety net). Inserts vote.
- *Rationale:* unique constraint + status check together prevent double-voting and out-of-window votes even under race conditions.

### 1.5 Status materialiser at `src/lib/server/voting/materialise.ts`

- `materialiseProposal(p, now)` advances `deliberating → active → closed → ratifying → ratified` based on timestamps and writes the new `status`/`result` if changed.
- Called on each `GET /api/proposals*` request for any proposal whose timestamps imply a transition.
- *Rationale:* avoids needing a cron/timer infra; the lazy approach is sufficient for a low-traffic governance app and is easier to test.

### 1.6 Optional cron-style sweep at startup

- On server boot (or first request to the voting API), run `materialiseAllStale()` so backed-up transitions land even without traffic to a specific proposal.
- *Rationale:* protects against the lazy-materialiser missing transitions during quiet periods.

### 1.7 Tests for Phase 0/1

- Unit tests for `computePeriods`, `resolveResult`, `materialiseProposal` covering: no-deliberation Operational, normal Strategic, Constitutional with ratification, tied → fails, all-zero score → no result, choice not in set → 400.
- Integration: vote uniqueness, level gate, status gate.
- *Rationale:* state machine + result resolver are the riskiest correctness surface; lock them with tests early.

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

- `MarkdownEditor.svelte`: simple textarea + toolbar (bold/italic/link/list/code/heading) + live preview pane.
- `MarkdownView.svelte`: renders sanitised HTML.
- Add `marked` + `dompurify` to dependencies (lightweight, well-known).
- *Rationale:* sanitisation is non-negotiable for member-authored content; `marked` + `dompurify` is the minimal pairing that gives correctness without pulling in a full editor framework.

### 2.7 Proposal form (`ProposalForm.svelte`)

- Type select, title input (140-char counter), markdown editor (10 000-char counter), tag chip input. Submits to `POST /api/proposals`. Disabled if level check fails (server is still authoritative).
- *Rationale:* matches spec §3.3; counters in the UI prevent the first-attempt 400 from char-limit overruns.

### 2.8 Tag autocomplete

- `GET /api/proposals/tags` returns distinct tags with usage counts; `ProposalForm` fetches and offers them as suggestions.
- *Rationale:* keeps tag vocabulary from fragmenting without forcing a fixed taxonomy.

---

## Phase 3 — Badge + integration with existing apps

Goal: red badge on the voting app + auto-creation flows for membership and blog.

### 3.1 Extend `src/lib/badges.svelte.ts`

- Add `voting: number` to `BadgeCounts`. Refresh fetches `GET /api/proposals?status=active&unvoted=1` and counts results.
- *Rationale:* same pattern as the other two badged apps; one extra fetch on auth.

### 3.2 Add `unvoted=1` filter to `GET /api/proposals`

- When `unvoted=1` and authenticated, filter out proposals the caller has already voted on.
- *Rationale:* keeps the badge query single-trip and avoids leaking the vote list to the badge code path.

### 3.3 Auto-create membership proposal in `POST /api/applications` ([+server.ts](src/routes/api/applications/+server.ts))

- After insert, call `createSystemProposal({ type: 'operational', choiceSetKey: 'membership', tags: ['Membership', 'System'], title: 'Membership Application: <fullName>', body: formatApplicationBody(application), linkedApplicationId })`.
- *Rationale:* removes the manual admin step; spec §6.3.

### 3.4 Replace Snapshot status enrichment in `GET /api/applications`

- Drop `getProposalStatus` / `getMembershipVotingResult` calls; instead join (or batch-fetch) the linked proposals and project equivalent fields (`votingStatus`, `votingResult`, `votingEnd`, `votingScores`).
- *Rationale:* preserves the `MembershipManager` UI contract while moving the source of truth to the local DB.

### 3.5 Remove "Create Snapshot Proposal" UI in `MembershipManager.svelte`

- Delete `createProposal` and the button. Add a link to the local proposal page instead.
- *Rationale:* admin no longer needs to do anything; surface the proposal id for context.

### 3.6 Auto-create blog proposal

- In the existing draft-publish flow ([api/blog/drafts/[id]/update-proposal/+server.ts](src/routes/api/blog/drafts/[id]/update-proposal/+server.ts)), replace the Snapshot creation with `createSystemProposal({ type: 'operational', choiceSetKey: 'blog', tags: ['Blog', 'System'], ..., linkedBlogDraftId })`.
- Update `BlogManager.svelte` to read status from local proposal instead of `getProposalForDraft`.
- *Rationale:* spec §6.4; same pipeline as membership for consistency.

### 3.7 Discord templates ([discord-templates.ts](src/lib/server/discord-templates.ts))

- Update `proposalCreatedMessage` to drop the link argument.
- Add `proposalClosedApproved`, `proposalClosedRejected`, `proposalRatified` (link-free).
- Wire them into the materialiser (fire-and-forget on transition).
- *Rationale:* spec §6.6; firing on transition keeps Discord in sync without a separate scheduler.

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

- **Lazy materialiser drift:** if no traffic hits the API, transitions stall. Phase 1.6 mitigates; consider a real cron later.
- **Markdown XSS:** sanitisation regressions are silent and dangerous — keep the test from §7.1 in CI.
- **Rollback:** keeping Snapshot columns in `applications` for one release (§5.4) is the rollback hatch.
- **Constitutional ratification timer:** edge case if a Constitutional vote passes but is invalidated mid-ratification — out of scope here, but document the manual override path.

## Phase ordering / merge dependencies

- 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 in order. Phases can be merged separately; the system is functional after each phase boundary except mid-phase. Phase 5.5 (historical import) is independent and can be deferred indefinitely.
