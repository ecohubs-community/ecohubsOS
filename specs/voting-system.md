# Spec: Internal Voting System

- **Status:** Draft — pending implementation spec
- **Author:** Stefan
- **Date:** 2026-05-01
- **Related:** `RCOS-ecohubs/layers/2-governance/01-decision-matrix.md`, `02-governance-protocol.md`

> Scope: replace the external Snapshot-based voting flow with a first-class voting app inside ecohubsOS. Membership applications and blog publications produce proposals automatically. Safe / Snapshot integrations stay available but become optional.

This document captures **what** changes; a follow-up spec round will capture **how**.

---

## 1. Goals

1. Members can browse, read, and vote on proposals without leaving ecohubsOS.
2. Eligible members can author proposals (with type-driven deliberation + voting periods).
3. Membership-application proposals and blog-publication proposals are created automatically.
4. The Safe-owner / Snapshot stack stops being a hard onboarding requirement and becomes opt-in tooling.

## 2. Non-goals

- On-chain governance / token-weighted voting (off-chain, one-member-one-vote).
- Public, unauthenticated proposal pages.
- Re-vote / reasoned-objection workflow (future spec).
- Vote weighting (flat one-member-one-vote; XP-weighted is future work).

---

## 3. New Voting App

Replaces the current `snapshot` entry in [data.ts](src/lib/data.ts) (which only links out to `snapshot.org/#/s:ecohubs.eth`). The new app is internal (`isInternalApp: true`) under category `governance`.

### 3.1 Proposal list view

- Default tab: **Active** (vote open, end date in the future).
- Filter tabs: **Past** (closed proposals — approved / rejected / needs review / tied).
- Secondary filter: by type (Operational / Strategic / Constitutional) and by tag.
- Each row shows: title, short description / excerpt, type badge, tag chips, end date (countdown for active), status badge, current vote count.
- "New Proposal" button visible only to eligible authors (see §4).

### 3.2 Proposal detail view

- Title, author, type, tags, created / deliberation-end / vote-end timestamps.
- Body rendered as markdown (sanitised).
- Voting widget:
  - One vote per user, any membership level.
  - Choices defined per proposal type (default: **For / Against / Needs Review** — see §3.4).
  - Vote is **irrevocable** until close (no change-vote in v1).
  - Live tally + voter list visible during and after the vote.
  - Clicking a choice opens a **reason modal** (plain text, max 1 000 chars, optional) before the vote is submitted.
- After close: result banner (Passed / Failed / Tied → fails per `02-governance-protocol.md`), final tally, full voter list with reasons.

### 3.3 Proposal creation

- Permission: Offcoin **Level ≥ 3**.
- Form fields:
  - **Title** — plain text, **max 140 chars**.
  - **Description** — markdown, simple editor (toolbar + live preview), **max 10 000 chars**.
  - **Type** — Operational / Strategic / Constitutional.
  - **Tags** — optional, free-text or chip-picker (re-use of common tags surfaced; multi-select).
- Server enforces: char limits, level check, type → duration mapping, tag normalisation.

### 3.4 Choice sets (extensible)

- Default choice set: `['For', 'Against', 'Needs Review']`.
- Stored on each proposal as a JSON snapshot, so other sets can be assigned per proposal type:
  - Membership applications → `['Approve', 'Reject', 'Needs Review']`
  - Blog publications → `['Publish', 'Reject', 'Needs Revision']`
- Implementation registers choice sets in code (`CHOICE_SETS` registry); choices are snapshotted onto the proposal at creation time so future registry edits don't change historical proposals.

#### Choice → result mapping (3-choice ballots)

The threshold (`majority` or `supermajority`) applies to the **first choice** ("For" / "Approve" / "Publish") against **all votes cast** (per protocol §"Voting Principles": "% of votes cast"). Resolution rules:

1. If first-choice share **meets the threshold** → result = `approved`.
2. Otherwise, the runner-up choice between Choice[1] (Against / Reject) and Choice[2] (Needs Review) by raw count determines the result:
   - Choice[1] wins → `rejected`
   - Choice[2] wins → `needs_review`
   - Choice[1] == Choice[2] → `tied` (treated as fail; status quo holds).
3. Zero votes cast → `rejected` (no mandate; status quo holds).

Examples (Strategic, majority threshold):
- 60% For / 30% Against / 10% Needs Review → `approved`.
- 40% For / 35% Against / 25% Needs Review → `rejected` (Against beats Needs Review).
- 30% For / 35% Against / 35% Needs Review → `tied`.

### 3.5 Type → period mapping (locked)

| Type           | Deliberation (before vote opens) | Vote duration | Threshold              | Ratification |
| -------------- | -------------------------------- | ------------- | ---------------------- | ------------ |
| Operational    | none                             | 3 d           | Simple majority (>50%) | none         |
| Strategic      | 5 d                              | 7 d           | Simple majority (>50%) | none         |
| Constitutional | 15 d                             | 14 d          | Supermajority (≥ ⅔)    | 30 d         |

- During deliberation: proposal is visible and discussable; voting widget is disabled with a "Voting opens in …" countdown.
- Constitutional ratification: after `closed` and `approved`, the proposal enters a `ratifying` status for 30 days; a status banner shows "Ratifying — effective on YYYY-MM-DD". After ratification expires it transitions to `ratified` and is treated as in force.
- Tied vote → fails (status quo holds, per protocol §"Voting Principles").

---

## 4. Eligibility

| Action                            | Who                                                |
| --------------------------------- | -------------------------------------------------- |
| Read proposals                    | Any authenticated user                             |
| Vote                              | Any authenticated user — one vote per proposal     |
| Create proposal                   | Authenticated user with Offcoin Level ≥ 3          |
| Auto-created (membership / blog)  | System (author shown as "System")                  |

- Voting only requires authentication — no Offcoin link, no wallet, no Safe ownership. A user that completed SSO login is a voting member.
- Proposal authoring still requires an Offcoin Level ≥ 3 lookup (server-side via `puckstackUserId` → Offcoin SDK). Users without Offcoin connection see "Connect Offcoin to author proposals" in place of the New Proposal button.
- No public / unauthenticated read in v1.
- This is the v1 mapping for the protocol's "Full Member" concept. A stricter definition (group membership, Safe owner, etc.) can replace it later without a schema change.

---

## 5. Active-vote badge

- Add `voting` to the badge store ([badges.svelte.ts](src/lib/badges.svelte.ts)).
- Count = number of active proposals the current user has **not yet voted on** (red badge).
- Refreshed on auth and on app open (same pattern as `membership-manager` and `blog-manager`).

---

## 6. Other changes triggered by this rework

### 6.1 Onboarding — drop Snapshot step (no replacement)

- Remove the `snapshot` step in [stepManager.ts](src/lib/onboarding/stepManager.ts) (`snapshot-open` / `snapshot-read` / `snapshot-vote`).
- Voting now happens inside ecohubsOS; no external account required.
- **Update (post-implementation):** an interim "Voting & Governance" onboarding step (with `voting-open` / `voting-read` / `voting-vote` substeps pointing at the new internal voting app) was added during Phase 4 and then dropped again — the voting app is one entry in the dock and members discover it naturally. The step manager just retires those substep ids for legacy progress validation. Net effect: no voting-related onboarding step in the default flow.

### 6.2 Onboarding — Wallet & Safe become optional

- Remove the `wallet-safe` step from the default onboarding sequence.
- Keep the existing apps `wallet-setup`, `wallet-connect`, `safe-proposal` — un-hide them and surface as a system app in the dock (single "Safe Membership" entry, or grouped). Users opt in only if they want Safe / treasury power.
- `safeOwnerStatus` on the user table stays — no longer required for proposal creation, but remains the gate for any future on-chain Safe action.

### 6.3 Membership applications — auto-create proposal

- Today: admin clicks "Create Snapshot Proposal" in [MembershipManager.svelte:160](src/lib/apps/membership-manager/MembershipManager.svelte:160), which triggers a client-side Snapshot SDK flow and updates the application via `POST /api/proposals`.
- New behaviour: when a new application lands (`POST /api/applications`), the server creates a **local** proposal automatically:
  - type = **Operational**
  - choice set = `['Approve', 'Reject', 'Needs Review']`
  - tags = `['Membership', 'System']`
  - title = `Membership Application: <fullName>`
  - body = generated from the application data (re-use the existing Snapshot body formatter).
  - vote duration = 3 d (Operational); no deliberation period.
- The application row links to the local proposal id; `snapshotProposalId` / `snapshotProposalLink` stay during the transition window, then are deprecated.
- Status enrichment in `GET /api/applications` ([+server.ts](src/routes/api/applications/+server.ts)) switches from `getProposalStatus()` (Snapshot) to local DB lookup.
- The "Create Proposal" button in the membership-manager UI is removed.

### 6.4 Blog publishing — same pipeline

- Auto-create a local proposal when a blog draft is submitted for publication:
  - type = **Operational**
  - choice set = `['Publish', 'Reject', 'Needs Revision']`
  - tags = `['Blog', 'System']`
  - vote duration = 3 d.
- Drop the Snapshot proposal creation flow in `blog-manager`; replace status reads with local DB lookup.

### 6.5 Snapshot integration — remove

- Drop `$lib/server/blog-snapshot.ts` and the `@snapshot-labs/snapshot.js` client-side dependency.
- Drop `SNAPSHOT_*` env vars (`SNAPSHOT_SPACE`, `SNAPSHOT_VOTING_DURATION`).
- One-time historical migration of existing Snapshot proposals into the new DB is **nice-to-have, optional** (see §7 Open items). If skipped, archive a static export instead.

### 6.6 Discord notifications

- Update `proposalCreatedMessage` ([discord-templates.ts](src/lib/server/discord-templates.ts)): drop the link, keep the descriptive text only.
- Add `proposalClosedApproved`, `proposalClosedRejected`, `proposalRatified` (Constitutional only) — all link-free.

---

## 7. Data model (sketch — detailed in implementation spec)

New tables (names indicative):

- `proposals` — id, type (`operational` / `strategic` / `constitutional`), title, body, authorUserId (nullable for system), tags (JSON array), createdAt, voteOpensAt, voteClosesAt, ratificationEndsAt (nullable), threshold (`majority` / `supermajority`), choiceSetKey, choices (JSON snapshot), status (`deliberating` / `active` / `closed` / `ratifying` / `ratified` / `withdrawn`), result (`approved` / `rejected` / `needs_review` / `tied` / nullable), discordNotifiedTransitions (JSON array of statuses already announced — for idempotency), linkedApplicationId (nullable, unique), linkedBlogDraftId (nullable, unique).
- `proposal_votes` — proposalId, userId, choice, reason (nullable, max 1 000 chars), votedAt. Unique on `(proposalId, userId)`.

Notes:
- `withdrawn` status is reserved in the enum but no UI in v1 (covers future protocol §"Withdrawal" without a follow-up migration).
- `linkedApplicationId` / `linkedBlogDraftId` are unique to prevent double-creation of system proposals.
- `discordNotifiedTransitions` prevents the lazy materialiser from firing duplicate notifications when called multiple times.

Migration: SQLite via Drizzle (`pnpm db:push`).

**Optional historical migration:** read closed Snapshot proposals from the configured space and import as `closed` proposals with a synthesised voter set (or a single aggregate row). Author = "Snapshot Import".

---

## 8. Governance-compliance note

The decision matrix in `01-decision-matrix.md` currently mandates Snapshot as the voting mechanism. None of the RCOS specs have been formally adopted yet, so we update the matrix and the protocol alongside this implementation:

- Replace `Snapshot vote` with `ecohubsOS internal vote` everywhere in the matrix Mechanism column.
- Update `Voting Principles` in `01-decision-matrix.md` to reference the internal voting tool.
- Update `02-governance-protocol.md` references to "Snapshot" (deliberation + execution + appeal sections).
- Track these doc edits as part of the implementation rollout.

---

## 9. Implementation hand-off (next round will detail)

1. Drizzle schema + migration for `proposals` and `proposal_votes`.
2. Routes: `/proposals` (list), `/proposals/[id]` (detail), `/api/proposals` (CRUD + vote endpoint).
3. Vote-close & ratification background job (timer or on-read materialisation).
4. Markdown sanitisation library choice + simple editor component (or re-use existing one if any).
5. Choice-set registry in code (`CHOICE_SETS`).
6. Eligibility checks (Offcoin level fetched server-side from existing offcoin module).
7. Badge store wiring + count query.
8. Membership / blog auto-creation hooks; deprecate `POST /api/proposals` (Snapshot-update endpoint).
9. Discord template updates (link-free).
10. Onboarding step manager edits + dock visibility flag changes for wallet/safe apps.
11. Removal of `@snapshot-labs/snapshot.js` and `$lib/server/blog-snapshot.ts`; clean up `SNAPSHOT_*` env vars.
12. RCOS doc edits (`01-decision-matrix.md`, `02-governance-protocol.md`) — separate PR in the RCOS-ecohubs repo.
13. Test plan: schema, eligibility gates, vote uniqueness, deliberation→active→closed→ratifying→ratified state machine, tied vote → fails, badge counts, auto-creation hooks.

---

## 10. Design decisions (worth being explicit about)

- **Live tally during voting:** counts and the voter list are visible while the vote is open. Trade-off: this enables a possible bandwagon effect; in exchange members can self-correct if a proposal is being misread. Accepted as v1 default; revisit if abuse surfaces.
- **Proposal immutability after submission:** title/body/tags are immutable once a proposal is submitted (no edits during deliberation in v1). Typo fixes require withdrawal + re-submission once that flow lands.
- **Voter identity in the list:** show `displayName` if set, else `name` from Authentik. Never show email or wallet address.
- **Tags:** max 5 tags per proposal, normalised to lower-kebab-case server-side.
- **Membership-application proposals — admin pre-screen:** auto-creation skips any admin pre-screen. Existing per-IP rate limit on `POST /api/applications` is the only spam gate. If spam becomes a problem, add an admin "publish proposal" button gating step (post-v1).
- **`pending` application status becomes vestigial:** with auto-creation, every application immediately has a proposal. Keep the column to avoid a breaking schema change but treat it as legacy.
- **Notifications to author:** v1 — author sees their own proposals in the list view, no separate ping. Discord channel notification is the broadcast.

## 11. Open items (post-decision)

- **Historical Snapshot migration** — optional, decide whether to spend effort on it or just archive a static export.
- **Snapshot mirror** — decide whether to keep a one-way mirror (announce passed proposals on Snapshot for transparency) or fully cut over. Default: full cut-over.
- **Withdrawal UI** — reserved in the schema; no UI in v1.
- **Re-vote / reasoned-objection workflow** — protocol §"Appeal and Review"; future spec.
