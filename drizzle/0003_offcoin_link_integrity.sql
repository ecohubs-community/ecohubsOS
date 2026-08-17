-- One Offcoin member per account, plus a cached ECO balance.
--
-- APPLY WITH sqlite3 -bail, as with 0002:
--
--     sqlite3 -bail "$PROD_DB" < drizzle/0003_offcoin_link_integrity.sql
--
-- ORDER MATTERS. The duplicate links must be cleared before the unique index
-- is created, or the index creation fails and the whole file rolls back.
--
-- BEFORE RUNNING, look at what will be cleared:
--
--   SELECT puckstack_user_id, group_concat(name, ' | ')
--   FROM user WHERE puckstack_user_id IS NOT NULL
--   GROUP BY puckstack_user_id HAVING count(*) > 1;
--
-- The rule below keeps the earliest-created account in each duplicate group and
-- unlinks the rest. In the known case that keeps the admin, who is the genuine
-- owner. Verify that holds for any group this reports before running it.

BEGIN TRANSACTION;

-- 1. Cached ECO, so the members list can show a real balance rather than the
--    placeholder random number it displayed before.
ALTER TABLE user ADD COLUMN offcoin_eco INTEGER;

-- 2. Unlink every duplicate except the earliest-created account in its group,
--    and clear the Offcoin snapshot that was read through the wrong link. The
--    snapshot goes too because it describes someone else's member: leaving a
--    level behind would keep the gates trusting a borrowed one.
UPDATE user
SET puckstack_user_id = NULL,
    offcoin_member_id = NULL,
    offcoin_xp = NULL,
    offcoin_eco = NULL,
    offcoin_level = NULL,
    offcoin_synced_at = NULL,
    updated_at = unixepoch()
WHERE puckstack_user_id IS NOT NULL
  AND id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY puckstack_user_id ORDER BY created_at, id
      ) AS rn
      FROM user WHERE puckstack_user_id IS NOT NULL
    ) WHERE rn = 1
  );

-- 3. Stop it happening again. SQLite treats NULLs as distinct, so the many
--    unlinked accounts do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS user_puckstack_user_id_unique
  ON user (puckstack_user_id);

COMMIT;
