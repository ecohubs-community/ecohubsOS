# Membership Levels — Adaptation Roadmap

Three Authentik roles × three states, with Offcoin level driving transitions and stewards/admins
driving level via transparent, logged XP grants. Exploration document — no code written yet.

---

## 1. The model

```
role   (Authentik)  none (= trial) | EcoHubs Member | EcoHubs Steward | EcoHubs Admin
status (DB)         active | standby | exited
```

Trial is the **absence** of a role, not a stored value — nothing to backfill, and role/status can
never contradict each other. Reaching `POLICY.levels.memberFromLevel` assigns the Member group,
which is simultaneously the grant of rights and the assumption of obligations.

Roles are **additive, highest-wins**: a Steward also holds Member, so voting comes from the Member
group naturally, external SSO apps checking for "Member" keep working, and "become an active
member again upon request" is just dropping the Steward group — no status change.

**Trial × standby is required.** The source table has Trial Members becoming Standby after 3
months without participation, so status applies to role-less accounts too. Status is fully
orthogonal to role.

### Two organisational changes from the original table

- **Only stewards and admins may propose.** Everyone else gets a friendly redirect to Discord
  (§4). This replaces the current Offcoin level-3 authoring gate.
- **Members can request app access** from inside the locked app, which opens the feedback widget
  prefilled. Trial members don't see those apps at all.

---

## 2. `$lib/policy.ts` — the one place gates live

Isomorphic on purpose: the server enforces from it, the client renders explanations from it. Two
copies of the number "level 1" is how the UI ends up lying to members.

```ts
export type Role = 'trial' | 'member' | 'steward' | 'admin';
export type MembershipStatus = 'active' | 'standby' | 'exited';

export const ROLE_GROUPS = {
	member: 'EcoHubs Member',
	steward: 'EcoHubs Steward',
	admin: 'EcoHubs Admin'
} as const;

export type Capability =
	| 'os.access'
	| 'proposal.create'
	| 'proposal.vote'
	| 'blog.write'
	| 'newsletter.write'
	| 'social.post'
	| 'blueprint.admin'
	| 'buddy.host'
	| 'rewards.grant'
	| 'onboarding.manage'
	| 'membership.exit'
	| 'admin.apps';

export const POLICY = {
	/** Level thresholds. THE tuning surface — change here, whole OS follows. */
	levels: {
		memberFromLevel: 1, // trial → member (auto, on Offcoin level-up webhook)
		stewardMinLevel: 3, // eligible to *request* steward
		adminMinLevel: 3
	},

	/** Inactivity timers in days; null disables a timer. */
	timers: {
		trialToStandby: 90,
		standbyToExited: 365,
		memberToStandby: 180,
		warnBeforeDays: [14, 7]
	},

	/** Reward-granting guardrails — XP grants are now a privilege-escalation path. */
	grants: {
		maxXpPerGrant: 100,
		maxXpPerStewardPerDay: 500, // same caps for stewards and admins
		maxEcoPerGrant: 500,
		allowSelfGrant: false,
		allowNegative: false // no subtractXp exists anyway; also blocks subtractTokens
	},

	/** Reactivation from standby (§7). */
	reactivation: {
		proposalType: 'operational', // already exactly 3-day vote, majority, no ratification
		cooldownDays: 30, // after a rejected request
		zeroVotesResult: 'needs_review' // override — silence must not auto-reject a member
	},

	/** The gate table. `grant` = additive Authentik group, for "can request access to…". */
	capabilities: {
		'os.access': { minRole: 'trial', statuses: ['active', 'standby'] },
		'proposal.vote': { minRole: 'member', statuses: ['active'] },
		'proposal.create': { minRole: 'steward', statuses: ['active'] },
		'voting.view': { minRole: 'trial', statuses: ['active'] }, // trial = read-only
		'blog.write': { minRole: 'member', statuses: ['active'], grant: 'EcoHubs Blog' },
		'newsletter.write': { minRole: 'member', statuses: ['active'], grant: 'EcoHubs Newsletter' },
		'blueprint.admin': { minRole: 'member', statuses: ['active'], grant: 'EcoHubs Blueprint' },
		'social.post': { minRole: 'member', statuses: ['active'], grant: 'EcoHubs Social' },
		'buddy.host': { minRole: 'member', statuses: ['active'] },
		'rewards.grant': { minRole: 'steward', statuses: ['active'] },
		'onboarding.manage': { minRole: 'steward', statuses: ['active'] },
		'membership.exit': { minRole: 'steward', statuses: ['active'] },
		'admin.apps': { minRole: 'admin', statuses: ['active'] }
	}
} as const;
```

`os.access` includes `standby` because standby members need a route in to request reactivation —
but the shell they get is the gated reactivation screen, not the desktop (§7).

**Invariant:** `membershipStatus` must be checked _before_ role resolution. Because trial is the
absence of a role, an exited member whose groups were removed would otherwise resolve to `trial`
and get trial-level OS access.

### The resolver returns _why_, not a boolean

```ts
export type CapabilityResult =
	| { allowed: true }
	| {
			allowed: false;
			reason: 'needs_role' | 'needs_status' | 'needs_grant';
			requiredRole: Role;
			unlockAtLevel: number | null;
			currentLevel: number;
			message: string;
	  };

export function resolveRole(groups: string[]): Role; // admin > steward > member > trial
export function can(cap: Capability, ctx: MemberContext): CapabilityResult;
```

### `reason` drives app visibility — no extra config needed

The three-tier visibility requirement (hidden / locked-with-request / accessible) falls straight
out of the `reason` field:

| `reason`       | Meaning                                | UI                                           |
| -------------- | -------------------------------------- | -------------------------------------------- |
| `needs_role`   | below the role minimum (e.g. trial)    | **hidden** from dock _and_ All Apps          |
| `needs_grant`  | right role, missing the additive grant | **visible, locked**, "Request access" button |
| `needs_status` | standby / exited                       | visible, locked, explains the status         |

So a trial member never sees the Newsletter app; a member sees it locked with an invitation to
request. `AppDefinition.groups` becomes `requires?: Capability` and app gating flows through the
same table as everything else (`groups` stays supported during migration).

### Server side

`$lib/server/membership.ts`: `requireCapability(locals, 'proposal.vote')`. Keep `requireAdmin`
and `requireStewardOrAdmin` as thin aliases so the ~23 existing call sites don't all change at once.

---

## 3. Offcoin: verified against the installed SDK

**Webhooks are the promotion signal.** `member.xp_updated` carries `previousXp, newXp,
previousLevel, newLevel`, and `verifyWebhookSignature()` ships in the SDK. Crossing
`memberFromLevel` is an event, not a poll — no scheduler needed.

> Signature verification needs the **raw** body: `await request.text()` before parsing.
> Webhooks retry, so key idempotency on the payload `id`.

**⚠️ There is no transaction ID.** Verified — the responses are:

```ts
XpOperationResult    { memberId, previousXp, newXp, amountAdded, achievementsGranted, permissionsGranted }
TokenOperationResult { memberId, previousBalance, newBalance, amountAdded?, amountSubtracted?, ... }
```

No ledger or transaction id anywhere. So:

- Our own grant UUID is the canonical reference.
- Store `previousXp` / `newXp` (or the balance pair) as a verifiable before/after trail — the
  sequence can be reconstructed and drift against Offcoin detected.
- Worth asking Offcoin to add a ledger id to the response.
- **`achievementsGranted` / `permissionsGranted` > 0 means the grant triggered an escalation.**
  Capture it on the audit row and say so in the Discord post — this is precisely the moment a
  steward's grant promoted someone.

**XP is add-only and reasonless.** `addXp(alias, amount)` takes no reason and there is no
`subtractXp`. `addTokens`/`subtractTokens` both take a reason and reverse cleanly. The UI must be
honest: XP grants are permanent, ECO grants are not.

### Workspace switch

`OffcoinClientOptions` is `{ baseUrl, clientId, clientSecret }` — no workspace or tenant
parameter. The tenant is implied by the credentials, so switching to the new linked workspace is
an **env var change only** (`OFFCOIN_CLIENT_ID` / `OFFCOIN_CLIENT_SECRET`); the module-level
client singleton in `$lib/server/offcoin.ts` needs no code change.

**⚠️ Alias carryover is the risk.** We address members as `puckstack:${puckstackUserId}`. If the
new linked workspace doesn't carry those aliases through the workspace-ID filter, every `getXp`
lookup breaks — and because `canAuthorProposal` currently fails closed, rights would vanish
silently with no error surfaced. Therefore:

1. Ship the fail-closed fix **before** the workspace switch.
2. Verify alias carryover against the new workspace with a read-only `members.list()` first.
3. Snapshots (`offcoinMemberId`) are workspace-scoped — store the workspace alongside, or plan a re-link.
4. Add an `ecohubs:${userId}` alias at connect time via `members.addAlias()` so future lookups are
   direct and workspace migrations stop being alias-fragile.

### Fixing the silent demotion

- Snapshot on `user`: `offcoinXp`, `offcoinLevel`, `offcoinSyncedAt`, `offcoinWorkspace`.
- Written by the webhook and by every successful read.
- `getOffcoinLevel(user)` → live read; **on failure return the snapshot**, flagged stale.
- `NotFoundError` → genuinely not an Offcoin member, level 0 is correct.
  `NetworkError` / `InternalError` / `RateLimitedError` → unknown, use snapshot, never demote.

### Puckstack

`POST /contributions/counts` returns `{unreadNotifications, tasksNeedingReview, openTasks}` —
_pending work_, not history, so it can't answer "has this member done anything in 3 months".
Needs adding on their side: `POST /contributions/activity {workspaceSlug, email}` →
`{lastTaskCompletedAt, lastCommentAt, tasksCompleted30d}`. Meanwhile XP deltas are a good proxy —
tasks award XP and the webhook fires immediately.

---

## 4. Proposal rights → Discord redirect

`ProposalList.svelte:108` currently renders the New Proposal button inside `{#if canAuthor}`.
Change to always render, with an `{:else}` branch opening a small modal:

> Hey, cool that you want to propose something to make ecohubs a better place. We are happy to
> hear all your ideas and critiques: please post a new discussion thread on Discord and we go from
> there, creating your proposal when it aligns with our manifesto and vision!

Link straight to the Discord discussions channel (`DISCORD_URL` already exists in
`$lib/contributions/contributionData.ts`). `canAuthor` moves from `offcoin.level >= 3` to
`can('proposal.create', ctx)`, and the server gate at `/api/proposals` POST becomes
`requireCapability('proposal.create')`.

---

## 5. Rewards app + Discord transparency

New internal app, `rewards.grant` (steward + admin).

- Member picker off `/api/admin/members`; amount; **reason (required)**; XP or ECO.
- `rewardGrants` table: `id` (our canonical ref), `userId`, `actorUserId`, `kind` (`xp`|`eco`),
  `amount`, `reason`, `previousValue`, `newValue`, `achievementsGranted`, `permissionsGranted`,
  `triggeredPromotion` (bool), `discordMessageId`, `createdAt`.
- Enforce every `POLICY.grants` guardrail server-side, including `allowSelfGrant: false`.
- **Discord transparency post** per grant: who granted, to whom, how much, and why — plus "this
  grant promoted X to Member" when `permissionsGranted > 0` or the level crossed the threshold.
  `sendDiscordMessage({ channelId })` already accepts an override, so this needs **no change to
  `discord.ts`** — just a new `DISCORD_REWARDS_CHANNEL_ID` env var for the new channel.
- Post _after_ the Offcoin call succeeds, store the returned message id, and never let a Discord
  failure roll back a successful grant (log and surface instead).

---

## 6. Access requests via the feedback widget

**Feedback is a FAB widget, not a dock app** — `os.openFeedback()` at `$lib/os.svelte.ts:159`,
rendered by `$lib/components/FeedbackWidget.svelte`. Two separate things carry the name:

| Thing                                           | Where                               | Rename to                                    |
| ----------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Member-facing widget heading + FAB label        | `FeedbackWidget.svelte:118`, `:110` | "Feedback & Requests" / "Feedback / Request" |
| Admin review app (`feedback-admin`, admin-only) | `src/lib/data.ts:285`               | "Feedback & Requests"                        |

Work needed:

- `openFeedback(prefill?: { title, message })` — currently takes no arguments.
- A shared `LockedApp` placeholder component rendering `CapabilityResult.message` plus a "Request
  access" button that calls `os.openFeedback({ title: 'Access request: Newsletter', message: … })`.
- The `feedback` table has **no type column** — add `kind: 'feedback' | 'request'` (+ optional
  `requestedCapability`) so the admin app can triage requests separately from bug reports.
- Closing the loop: a "Grant access" button in the admin app calling `/api/admin/roles` is worth
  building — otherwise an approved request means manually crossing to the Members app.

---

## 7. Standby, reactivation, and exit

### The lucky break: `operational` is already exactly right

`$lib/server/voting/periods.ts:12` —
`operational: { deliberationDays: 0, voteDays: 3, threshold: 'majority', ratificationDays: 0 }`.

A 3-day majority vote with no deliberation and no ratification phase. The reactivation flow needs
**no new voting configuration at all**. `proposals.authorUserId` is already nullable "for
system-generated proposals" and `$lib/server/voting/system-proposal.ts` is the existing creation
path — reactivation reuses it rather than going through `POST /api/proposals` (which is now
steward-gated and would reject a standby member).

### Flow

1. Standby member logs in → `hooks.server.ts` routes them to a gated `/standby` screen (same
   pattern as the existing `onboardingCompletedAt` redirect at `hooks.server.ts:139`), not the desktop.
2. Screen shows the reactivation prompt + reason textarea + send.
3. Submit creates: an `applications` row with `type: 'reactivation'`, **and** a linked
   system-authored operational proposal via `createSystemProposal`.
4. 3-day majority vote by active members.
5. `materialiseProposal` closes it → the transition handler applies the membership change and
   sends the result email.
6. The row surfaces in the Membership Applications app under a reactivation filter/tab.

### ⚠️ Three things that break if not handled

**1. Zero votes currently auto-reject.** `resolve.ts` returns `'rejected'` when `total === 0`
("no mandate; status quo holds"). Correct for a policy proposal — _wrong for a person_: a member
who did nothing wrong gets refused because nobody voted in three days. Reactivation needs the
`zeroVotesResult: 'needs_review'` override, routing to a steward decision instead.

**2. The visibility cutoff bug.** `getMembershipVisibility()` anchors the caller's cutoff to their
latest `applications.submittedAt` **with no type filter**. The moment a reactivation creates a new
application row for that member, their own cutoff jumps forward to the reactivation date and they
retroactively, silently lose visibility of every application and membership vote between their
original join and their return. **The cutoff query must filter to `type = 'membership'`.** This is
a hard prerequisite of adding the row type, not a follow-up.

**3. The member can't see their own vote.** The visibility rule excludes
`lower(email) = caller`, so the reactivating member cannot see their own reactivation proposal via
`/api/proposals`. That's arguably desirable (no campaigning), but it means the `/standby` screen
must read status from a dedicated endpoint scoped to the caller's own request — not from the
proposals list.

### Also needed

- **Idempotent email on close.** `materialiseProposal` is lazy-on-read, so the transition fires on
  whichever request happens to touch it — and could fire repeatedly. Copy the existing
  `discordNotifiedTransitions` atomic-claim trick (`materialise.ts:60`) for the email so retried
  reads can't double-send. Static templates per case: approved / rejected / needs_review, plus a
  "request received" confirmation.
- **The `/standby` screen must trigger materialisation itself**, so the member's own visit resolves
  a finished vote rather than waiting for someone else's request.
- **Cooldown** (`POLICY.reactivation.cooldownDays`) after a rejection, else reactivation requests
  become a spam vector on the community's attention.
- Standby members can't vote (`proposal.vote` requires `active`), so they can't vote on their own
  reactivation — already covered by the status gate, no extra guard needed.

### Exit

`memberOnboarding.standbyAt` becomes **derived** from `user.membershipStatus === 'standby'`,
consistent with how the board already derives every other stage — one source of truth, and standby
finally means something.

**⚠️ Scope limit:** the board only contains rows from accepted applications. A member of two years
who requests exit may have no onboarding row, or a completed one that's off the board. So
`executeExit(userId, reason)` lives in a shared service surfaced in **both** Member Onboarding and
the Members app, with Members as the primary route for long-standing members.

`executeExit` — idempotent: set `membershipStatus = 'exited'`, remove all role groups in Authentik,
**deactivate the Authentik user** (`is_active: false`), invalidate sessions, Listmonk unsubscribe,
remove the Discord role, `showOnWebsite = false`, membership event.

Group removal alone is not enough: with trial defined as the absence of a role, an exited member
would log straight back in _as a trial member_. Hence both the DB status check (fast, ours,
reversible) and Authentik deactivation (cuts external SSO apps too).

**Three new helpers needed**: `setAuthentikUserActive()` (only group add/remove exist today),
Listmonk unsubscribe (`listmonk.ts` has only `subscribeToNewsletter`), and Discord role removal
(`discord.ts` has only `sendDiscordMessage` — but `discord/callback/+server.ts:154` shows the
role-assignment call shape to invert). Discord role removal, not a server kick.

### ✅ Re-application resets XP — resolved

Returning members should "start over with 0 ECO/XP and trial membership". This was blocked:
there is no `subtractXp`, so 0 XP was unreachable.

Resolved by adding `DELETE /api/v1/members/:alias` to Offcoin (SDK 0.0.12 `members.delete()`) and
calling it from `executeExit` as its final step. The member row and its whole history cascade
away, so a returning person's alias resolves to nothing and `ensureMember` creates a fresh member
at 0.

Two constraints that came out of wiring it:

- **Deletion must run after the Discord step.** The Discord user id is not stored locally — it
  lives as a `discord:<id>` alias on the Offcoin member — so deleting first destroys the only
  record of which Discord account to strip.
- **The local snapshot is cleared unconditionally**, whether or not the delete succeeded.
  `can()` reads `offcoinLevel`, so a stale value would gate a returning trial member as though
  they still held the level they left with.

`offcoinMemberId` is therefore per _membership episode_, not per person.

---

## 8. Phases

| #   | Phase                                                                                | Size |
| --- | ------------------------------------------------------------------------------------ | ---- |
| 0   | Decisions (see §10)                                                                  | —    |
| 1   | `policy.ts` + status/role foundation + Member group backfill                         | M    |
| 2   | Offcoin hardening: snapshot, fail-open, alias `ecohubs:` — **then** workspace switch | S–M  |
| 3   | Enforce + explain: gates, three-tier app visibility, Discord propose modal           | M    |
| 4   | Offcoin webhook → auto-promotion                                                     | S    |
| 5   | Rewards app + audit table + Discord transparency channel                             | M    |
| 6   | Access requests: `openFeedback` prefill, `LockedApp`, feedback `kind`, renames       | S–M  |
| 7   | Participation tracking (partly blocked on Puckstack)                                 | M    |
| 8   | Timer transitions — flag for human confirm, never auto-execute                       | L    |
| 9   | Standby/exit service + Member Onboarding & Members actions                           | L    |

Phase 2 before 3 is deliberate: never ship gates that read a fail-closed level, and never switch
workspaces while that's true.

---

## 9. Cross-cutting risks

- **Never auto-revoke.** Upgrades auto-apply; downgrades always wait for a steward or admin.
- **Grandfather current voters** into the Member group in Phase 1, before Phase 3's vote gate.
- **Offcoin is load-bearing.** Snapshot-backed reads are mandatory once level drives roles.
- **Membership visibility.** Any new endpoint exposing membership data must call
  `getMembershipVisibility()` (`$lib/server/membership-visibility.ts`).
- **Migration friction.** `pnpm db:push` is interactive; column adds via `sqlite3 ALTER TABLE`;
  `nvm use 22` before any pnpm command.
- Adding a user field touches five files: schema, `src/app.d.ts`, `hooks.server.ts`,
  `$lib/auth.svelte.ts`, and both `+page.server.ts` loads (`/` and `/onboarding`).

---

## 10. Decisions taken

1. **Standby keeps gated OS access** — a `/standby` reactivation screen only. Reason text →
   system-authored operational proposal (3-day majority) → result email → row in Membership
   Applications as type `reactivation`. See §7 for the three sharp edges.
2. **Steward remains request + approval**, unchanged by proposals becoming steward-only.
3. **Trial members get read-only Voting** (`voting.view` capability) — they see the community
   decide, they just can't vote or propose.
4. **Same grant caps for stewards and admins.** Self-grants blocked, negative grants blocked.
5. **Exit = Discord role removal + Authentik deactivation**, not a server kick. Group removal
   alone would let exited members back in as trial members (§7).
6. **Three separate grant groups** — Blog, Newsletter, Blueprint each requested independently.
   Note Blueprint is currently an ungated external-URL app and becomes grant-gated.
7. **Re-application = new row, trial, 0 ECO** — but see §7: **0 XP is not achievable** with the
   current SDK.

## 11. Still open

- Offcoin: XP reset / member-delete endpoint, or mint a new member per membership episode?
- Offcoin: add a ledger/transaction id to grant responses?
- Puckstack: add `/contributions/activity` for participation history?
- Should a rejected reactivation notify the member of the reason(s), given voters' reasons are
  recorded on `proposalVotes.reason`? Transparency vs. protecting voters from blowback.
