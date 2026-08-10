-- Membership policy: levels, statuses, reviews, cases, drafted emails, grants.
--
-- APPLY WITH sqlite3, NOT `pnpm db:migrate`. The -bail flag is required:
--
--     sqlite3 -bail <production.db> < drizzle/0002_membership_policy.sql
--
-- Without -bail the shell prints each error and carries on, so the COMMIT at
-- the end commits whatever succeeded and you get a half-migrated schema. With
-- it, the first error aborts and the open transaction is rolled back. This was
-- measured, not assumed.
--
-- `__drizzle_migrations` is empty in this project — every change so far went in
-- via `db:push` or by hand, so `drizzle-kit migrate` would try to replay
-- 0000 and 0001 against a database that already has them. This file is
-- therefore deliberately absent from drizzle/meta/_journal.json.
--
-- Re-running is safe but not silent: the CREATEs are IF NOT EXISTS, while
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so a second run stops at the first
-- ALTER with "duplicate column name" and changes nothing. To resume a genuinely
-- partial run, check `PRAGMA table_info(user);` and delete the ALTERs that
-- already landed.

BEGIN TRANSACTION;

-- --------------------------------------------------------------------------
-- user: membership state, participation timers, Offcoin snapshot
-- --------------------------------------------------------------------------

-- Existing accounts are active members of a community that already exists;
-- defaulting to anything else would put everyone on standby at deploy.
ALTER TABLE user ADD COLUMN membership_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE user ADD COLUMN membership_status_since INTEGER;
ALTER TABLE user ADD COLUMN standby_reason TEXT;
ALTER TABLE user ADD COLUMN exit_reason TEXT;

-- Offcoin snapshot. Null, not 0: "we have never synced" and "they have no XP"
-- are different, and the level gates must not read an unsynced account as
-- level 0 and treat it as unqualified.
ALTER TABLE user ADD COLUMN offcoin_member_id TEXT;
ALTER TABLE user ADD COLUMN offcoin_xp INTEGER;
ALTER TABLE user ADD COLUMN offcoin_level INTEGER;
ALTER TABLE user ADD COLUMN offcoin_synced_at INTEGER;

-- Participation. Null means "never recorded", which the review evaluator
-- deliberately reads as no evidence rather than as inactive-since-forever.
ALTER TABLE user ADD COLUMN last_participation_at INTEGER;
ALTER TABLE user ADD COLUMN last_participation_source TEXT;
ALTER TABLE user ADD COLUMN puckstack_activity_synced_at INTEGER;

-- --------------------------------------------------------------------------
-- applications: separate a reactivation request from a first-time application
-- --------------------------------------------------------------------------

-- Every existing row is a membership application. The distinction matters to
-- the visibility cutoff, which keys off this column — a reactivation row
-- counted as an application would retroactively hide a member's own history.
ALTER TABLE applications ADD COLUMN type TEXT NOT NULL DEFAULT 'membership';

-- --------------------------------------------------------------------------
-- Audit trail of every role and status change
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  from_role TEXT,
  to_role TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

-- --------------------------------------------------------------------------
-- Review queue: a timer elapsing proposes a change, a human decides it
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  days_elapsed INTEGER NOT NULL,
  threshold_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at INTEGER NOT NULL
);

-- The evaluator runs on every read of the queue. Without this, one member with
-- an elapsed timer would accumulate a new proposal per page load.
CREATE UNIQUE INDEX IF NOT EXISTS membership_reviews_pending_unique
  ON membership_reviews (user_id) WHERE status = 'pending';

-- --------------------------------------------------------------------------
-- Advance warnings before a timer elapses
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_warnings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  cycle_anchor INTEGER NOT NULL,
  kind TEXT NOT NULL,
  drafted INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- One warning per mark per cycle. `cycle_anchor` is what makes a member who
-- participates again — moving the anchor — eligible to be warned a second time
-- without the first cycle's rows blocking it.
CREATE UNIQUE INDEX IF NOT EXISTS membership_warnings_cycle_unique
  ON membership_warnings (user_id, days_before, cycle_anchor);

-- --------------------------------------------------------------------------
-- Disciplinary cases: a steward suspends, the community removes
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_cases (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  opened_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  public_summary TEXT NOT NULL,
  private_notes TEXT,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'voting',
  previous_status TEXT NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS membership_cases_proposal_idx ON membership_cases (proposal_id);
CREATE INDEX IF NOT EXISTS membership_cases_open_idx ON membership_cases (user_id, status);

-- --------------------------------------------------------------------------
-- Outbound member email, drafted rather than sent
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS member_emails (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  related_id TEXT,
  sent_at INTEGER,
  sent_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  dismissed_reason TEXT,
  created_at INTEGER NOT NULL
);

-- One draft per (member, kind, subject) — a lazily-evaluated timer must not
-- queue the same warning on every page load. Partial, because `related_id` is
-- null for drafts that are not about a specific row.
CREATE UNIQUE INDEX IF NOT EXISTS member_emails_dedupe
  ON member_emails (user_id, kind, related_id) WHERE related_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS member_emails_pending ON member_emails (status);

-- --------------------------------------------------------------------------
-- Reward grants: the local half of the Offcoin ledger
-- --------------------------------------------------------------------------

-- `actor_user_id` is RESTRICT, not CASCADE: deleting a steward must not erase
-- the record of what they granted. The grants are the community's audit trail,
-- not the granter's.
CREATE TABLE IF NOT EXISTS reward_grants (
  id TEXT PRIMARY KEY NOT NULL,
  recipient_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  eco INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  reason TEXT NOT NULL,
  offcoin_eco_tx_id TEXT,
  offcoin_xp_tx_id TEXT,
  announced_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Reads the actor's daily XP total on every grant.
CREATE INDEX IF NOT EXISTS reward_grants_actor_day ON reward_grants (actor_user_id, created_at);

COMMIT;
