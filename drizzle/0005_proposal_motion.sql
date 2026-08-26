-- Proposals: the optional motion — the exact wording a Yes vote ratifies.
--
-- APPLY WITH sqlite3 -bail, as with 0002 through 0004:
--
--     sqlite3 -bail "$PROD_DB" < drizzle/0005_proposal_motion.sql
--
-- Without -bail the shell prints each error and carries on, so the COMMIT at
-- the end commits whatever succeeded. With it, the first error aborts and the
-- open transaction is rolled back.
--
-- Deliberately absent from drizzle/meta/_journal.json, for the reason given at
-- the top of 0002: `__drizzle_migrations` is empty in this project, so
-- `drizzle-kit migrate` would try to replay 0000 and 0001 against a database
-- that already has them.
--
-- NOT re-runnable: SQLite has no `ADD COLUMN IF NOT EXISTS`, so a second run
-- stops at "duplicate column name" and changes nothing. Check
-- `PRAGMA table_info(proposals);` before re-running a partial one.
--
-- No data migration. Every existing proposal keeps motion NULL, which is
-- exactly right: none of them were written with a separate motion, and the
-- detail view renders the section only when the column is non-empty. Nothing
-- reads this column before the deploy that introduces it.

BEGIN TRANSACTION;

-- Nullable with no default, because "this vote carries no motion" is a real and
-- common state, not a missing value. `body` says what the proposal is about;
-- this is the text being agreed to verbatim. Empty and whitespace-only strings
-- are normalised to NULL on write (see POST /api/proposals) so that the two
-- ways of saying "no motion" cannot both exist in the table.
ALTER TABLE proposals ADD COLUMN motion TEXT;

COMMIT;
