-- Wayfinder: which videos a member has finished, and what they were paid for it.
--
-- APPLY WITH sqlite3 -bail, as with 0002 and 0003:
--
--     sqlite3 -bail "$PROD_DB" < drizzle/0004_wayfinder_watches.sql
--
-- Safe to re-run: every statement is guarded by IF NOT EXISTS. Nothing here
-- touches existing rows, so there is nothing to inspect beforehand.
--
-- MUST be applied before the app serves /api/wayfinder/* or the admin backfill.
-- Without it the progress endpoint, the reward path and the backfill all fail
-- against a database that has never seen this table.
--
-- The welcome video needs no data migration. `user.intro_watched_at` is folded
-- in as an implicit watch by getWatchedVideos (see $lib/server/wayfinder.ts), so
-- members who watched it before Wayfinder existed keep their progress with no
-- rows written here. Paying them for it is a separate, deliberate step —
-- POST /api/admin/wayfinder-backfill, dry run first.

BEGIN TRANSACTION;

-- One row per (member, video). The row's existence is the "watched" flag, and
-- the reward columns turn that same row into the payout's claim ticket.
CREATE TABLE IF NOT EXISTS wayfinder_watches (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- Deliberately a plain string, not a foreign key: the catalogue lives in code
  -- ($lib/wayfinder/videos.ts), so a video can be added or retired without a
  -- migration. Rows for a retired video stop matching and drop out quietly.
  video_id TEXT NOT NULL,
  watched_at INTEGER NOT NULL,

  -- Reward. `reward_claimed_at` is taken before Offcoin is called, by an update
  -- conditional on it still being NULL; `rewarded_at` is set once the payout
  -- has landed. A row claimed but never rewarded is a payout that died in
  -- flight — see the note in $lib/server/wayfinder-rewards.ts.
  reward_claimed_at INTEGER,
  rewarded_at INTEGER,
  reward_eco INTEGER,
  reward_xp INTEGER,
  offcoin_eco_tx_id TEXT,
  offcoin_xp_tx_id TEXT
);

-- THIS INDEX IS THE PAYMENT GUARANTEE, not just a lookup optimisation. It is
-- what makes exactly one row claimable per (member, video), so a double-click,
-- two tabs, a retried request and a second backfill run all reduce to one race
-- with one winner. Without it the same video can be paid for twice.
CREATE UNIQUE INDEX IF NOT EXISTS wayfinder_watches_user_video_unique
  ON wayfinder_watches (user_id, video_id);

COMMIT;
