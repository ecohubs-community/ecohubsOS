-- Store the member's Discord link locally.
--
-- APPLY WITH sqlite3 -bail, as with 0002:
--
--     sqlite3 -bail "$PROD_DB" < drizzle/0004_discord_link.sql
--
-- Without -bail the shell prints an error, carries on, and the trailing COMMIT
-- commits a half-migrated schema. SQLite has no ADD COLUMN IF NOT EXISTS, so a
-- second run fails loudly — that is intended.
--
-- Until now the Discord id was only kept as a `discord:<id>` alias on the
-- Offcoin member, and only for members with a wallet connected — which
-- onboarding no longer asks for. So most members had no record of which Discord
-- account to strip on exit, and the onboarding step was marked done by the
-- browser whether or not the role was granted.

BEGIN TRANSACTION;

ALTER TABLE user ADD COLUMN discord_user_id TEXT;
-- Set only once the Member role was actually granted.
ALTER TABLE user ADD COLUMN discord_connected_at INTEGER;

COMMIT;
