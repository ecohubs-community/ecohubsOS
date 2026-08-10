# Deploy: membership policy

Three repos, one rollout. Prepared 2026-08-06.

Everything below was verified against the actual repos and the live `local.db`
on the date above. Where a step could not be verified from here — production
credentials, the Authentik tenant, the Offcoin dashboard — it says so.

---

## What ships

| Repo      | Merged as                           | State                         |
| --------- | ----------------------------------- | ----------------------------- |
| offcoin   | `mediakular/offcoin` PR #2          | **merged** — `main` @ db96880 |
| puckstack | `mediakular/puckstack` PR #2        | **merged** — `main` @ 175a60a |
| ecohubsOS | `ecohubs-community/ecohubsOS` PR #3 | **merged** — plus PR #4 open  |

Verify the deployed revision by SHA rather than by branch name — a branch moves,
and this table is a snapshot. `git rev-parse origin/main` in each repo before
you deploy it.

> An earlier revision of this table claimed offcoin and puckstack had no
> upstream. That was wrong: it read "no local tracking branch" as "never
> pushed". Both were pushed and merged.

---

## Order is not optional

**offcoin → puckstack → ecohubsOS.**

Two hard dependencies, both found while reviewing this branch:

1. **puckstack needs offcoin first.** `ensureMember` adopts pre-scoping Offcoin
   members by calling `addAlias`, and it refuses a member that already carries a
   scoped alias. That check reads `member.aliases`, and alias resolution is only
   tenant-correct after the offcoin fix. Deploy puckstack first and adoption can
   resolve another workspace's member.

2. **ecohubsOS needs puckstack first.** It addresses Offcoin members as
   `puckstack:{workspaceId}:{userId}`. Until puckstack has created or adopted
   members under that alias, every ecohubsOS lookup falls back to the legacy
   unscoped form — which may resolve to a member another workspace has since
   adopted, crediting a grant to an economy that is not ours.

---

## 1. offcoin

- [ ] Merge `feat/grant-reason-and-activity` → `main`
- [ ] Deploy
- [ ] Smoke: `GET /api/v1/members` returns `lastActivityAt` on each row
- [ ] Smoke: two workspaces holding the same alias (e.g. `discord:*`) each
      resolve to **their own** member — this is the bug the branch fixes
- [ ] SDK `@offcoin/sdk@0.0.12` is already published; no republish needed. The
      API change makes the types it already declares honest, rather than
      changing them.

## 2. puckstack

- [ ] Set `PUCKSTACK_WORKSPACE_ID`-equivalent config if the deploy target needs
      it (puckstack derives the workspace itself; nothing new required)
- [ ] Merge `fix/eco-xp-ratio-duplication` → `main`
- [ ] Deploy
- [ ] **Watch the adoption log.** First login per user emits either
      `[Offcoin] Adopted legacy member <id> into workspace <ws>` or nothing.
      A `already adopted as <alias>; <ws> starts fresh` line means that person
      belongs to more than one workspace and this one starts empty — expected,
      but worth knowing who.
- [ ] Spot-check one long-standing user's ECO/XP is unchanged after their first
      login. **This is the step that would catch a balance loss**, and it is
      only observable on first login per user.

## 3. ecohubsOS

### 3a. Environment

- [ ] `PUCKSTACK_WORKSPACE_ID` — the workspace **UUID** (`workspaces.id`), not
      the `ecohubs` slug. Reported set already; re-confirm on the deploy target.
- [ ] `OFFCOIN_WEBHOOK_SECRET` — `whsec_…` from the Offcoin webhook settings.
      Without it the endpoint 500s every delivery and level-ups stop promoting
      trial members to member.
- [ ] `OFFCOIN_CLIENT_ID` / `OFFCOIN_CLIENT_SECRET`
- [ ] Confirm the Offcoin webhook points at
      `https://<host>/api/offcoin/webhook` and is subscribed to
      `member.xp.updated`

### 3b. Database

- [ ] **Back up the production database first.** The migration is not
      reversible without one.
- [ ] Apply (the `-bail` flag is required — see the file header for why):

```bash
PROD_DB=/path/to/production.db
sqlite3 -bail "$PROD_DB" < drizzle/0002_membership_policy.sql
```

- [ ] Verify: `PRAGMA table_info(user);` shows 42 columns
- [ ] Verify: `SELECT count(*) FROM user WHERE membership_status='active';`
      equals the total user count
- [ ] Verify: `SELECT count(*) FROM applications WHERE type='membership';`
      equals the total application count

The migration adds 6 tables, 11 `user` columns and `applications.type`. It was
tested by reconstructing the pre-branch schema from `local.db`, applying the
file, and diffing: **234 schema objects, byte-identical**, with 18 users, 26
applications and 32 proposals preserved and defaults backfilled.

### 3c. Authentik — do this before the deploy is reachable

- [ ] Confirm the `EcoHubs Member` group exists (the backfill fails loudly if
      not, before touching any account)
- [ ] Confirm `EcoHubs Steward` and `EcoHubs Admin` exist
- [ ] **Automatic member-group assignment stays off** — it was turned off for
      this rollout, and promotion is now driven by the Offcoin level webhook

### 3d. Deploy, then immediately backfill

> **The sharp edge.** A trial member is defined by the _absence_ of a role
> group, and `proposal.vote` requires `member`. Between the deploy and the
> backfill, every account not already in `EcoHubs Member` and not a
> steward/admin **cannot vote**. The backfill endpoint only exists once
> deployed, so this window cannot be eliminated — only kept short. Plan to run
> it within minutes, not hours, and ideally at a quiet time.

- [ ] Deploy
- [ ] Dry run:

```bash
HOST=https://os.ecohubs.community
SESSION='<paste the admin session cookie>'
curl -X POST "$HOST/api/admin/membership-backfill" -H 'Content-Type: application/json' -H "Cookie: $SESSION" -d '{"dryRun":true}'
```

- [ ] **Read `addedMembers` before the real run.** It lists who would be granted
      membership by name and email — the point is to make grandfathering a
      decision taken with names in front of you, not a count. Last known state
      was 23 of 32 accounts already in the group.
- [ ] Check `skippedInactive` — those are non-active accounts deliberately left
      alone, so an exited person is not quietly reinstated
- [ ] Real run (same call, `{"dryRun":false}` or no body)
- [ ] Confirm `failed` is empty; re-run if not (it is idempotent)

### 3e. Verify

- [ ] An ordinary member can still vote — **the thing the backfill protects**
- [ ] A steward sees Member Onboarding, Rewards and the review queue
- [ ] A trial member sees Voting read-only and no propose button
- [ ] Grant a small reward end-to-end: ECO and XP both land in Offcoin, the
      Discord post appears, `reward_grants` gets a row with both transaction ids
- [ ] `/api/public/members` returns members-and-above only, no trial accounts
- [ ] Trigger an Offcoin level-up and confirm the webhook promotes to member

---

## Rollback

**offcoin / puckstack** — revert and redeploy. Neither has a schema change.
Puckstack adoption is _not_ automatically undone: an adopted member keeps the
scoped alias. That is harmless (the balance is intact and reachable) but it
means re-running adoption later is a no-op for those users, by design.

**ecohubsOS** — the app reverts cleanly, but **the migration does not roll
back**. Restore the backup taken in 3b. The new columns and tables are additive
and unused by `main`, so leaving them in place while running the old app is
also safe if a restore is worse than the alternative.

**The backfill does not roll back either.** It adds people to an Authentik
group and mirrors that into `user.groups`; reverting the app leaves both in
place.

This is _not_ harmless any more. `main` now contains `policy.ts` and nine
endpoints calling `requireCapability`, so `EcoHubs Member` grants real
authority — voting, buddy calls, requestable tool access. An over-broad
backfill therefore leaves people holding rights a rollback does not remove.

**There is no in-app undo for this group, by design.** `EcoHubs Member` is
deliberately absent from the `/api/admin/groups` allowlist — the level-up
webhook owns it, so an admin cannot hand out or withdraw membership by hand
(`group-grants.spec.ts` asserts this). Reversing a mis-scoped backfill means:

1. Remove the group in Authentik for each affected account.
2. Clear the local mirror, which is what gates the current session —
   `UPDATE user SET groups = '[]' WHERE id = ?`. It otherwise refreshes only on
   their next OIDC login.

**Keep the output of the real run, not the dry run.** They can differ — group
membership may change between the two calls — and only the real run records what
was actually granted. `addedMembers` carries `userId`, `email` and `name`, which
is what both steps above need.

> Worth deciding before you need it: making membership admin-manageable would
> give this a one-call undo, at the cost of letting an admin grant membership
> without the level. That is a real trade against the webhook-owns-it design,
> so it is left as-is rather than changed under deploy pressure.

Reward grants are the one thing that genuinely cannot be reversed:
`POLICY.grants.allowNegative` is false and Offcoin has no `subtractXp` at all.
A wrong grant is corrected by granting the difference elsewhere, not by
clawing back. `reward_grants` holds both Offcoin transaction ids for
reconciliation.

### Roll back if

- Members cannot vote after the backfill completes (gate misfiring, not a
  timing window)
- Grants debit Offcoin without recording a `reward_grants` row
- The webhook promotes the wrong accounts
- Any user reports their ECO/XP reset to zero — **stop and investigate before
  more users log in**, since adoption runs once per user on first login

---

## Known gaps, accepted

- **No staging environment.** Every check above is production-first; the
  migration rehearsal against a copy of the live DB is the substitute.
- **No CI.** The suites were run locally, per repo — these are three separate
  totals, not addends: offcoin 120, puckstack 15, ecohubsOS 316. All green,
  0 type errors in all three.
- **Timers are lazy, not scheduled.** Reviews and warnings materialise when a
  steward opens the queue. Nothing fires unless someone looks, which is
  deliberate — there is no scheduler in this stack.
- `POLICY.grants.maxEcoPerGrant` (500) is unreachable; the XP cap binds first
  at 66 ECO. Policy values are yours to set, but the 500 is currently dead.
