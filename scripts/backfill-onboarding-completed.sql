-- Backfill onboarding_completed_at for members who finished onboarding
-- before the completion timestamp / current flow existed.
--
-- Why: the admin members status is derived from "completion-blocking" steps,
-- but other parts of the app may still read the onboarding_completed_at
-- column. This sets that column for members who satisfy the completion rule
-- but have a NULL timestamp.
--
-- Completion rule (matches completionRequiredSubstepIds() in
-- src/lib/onboarding/stepManager.ts as of 2026-05-26): all of
--   manifesto-sign, profile-setup, puckstack-signup, discord-connect
-- must be present in onboarding_progress. The soft "discord-introduce"
-- ("Introduce yourself") substep is intentionally NOT required.
--
-- IMPORTANT: if the onboarding flow's blocking steps change, update the
-- four substep keys below to match.
--
-- Timestamps are stored as Unix epoch SECONDS (drizzle integer mode:'timestamp').
-- The completion time is set to the latest of the four blocking substeps.
--
-- Usage (back up first!):
--   sqlite3 path/to/local.db < scripts/backfill-onboarding-completed.sql
--
-- Dry run — preview who would be updated before running the UPDATE:
--   SELECT id, name FROM user
--   WHERE onboarding_completed_at IS NULL
--     AND json_extract(onboarding_progress, '$."manifesto-sign"')   IS NOT NULL
--     AND json_extract(onboarding_progress, '$."profile-setup"')    IS NOT NULL
--     AND json_extract(onboarding_progress, '$."puckstack-signup"') IS NOT NULL
--     AND json_extract(onboarding_progress, '$."discord-connect"')  IS NOT NULL;

BEGIN TRANSACTION;

UPDATE user
SET
	onboarding_completed_at = CAST(
		MAX(
			CAST(strftime('%s', json_extract(onboarding_progress, '$."manifesto-sign"'))   AS INTEGER),
			CAST(strftime('%s', json_extract(onboarding_progress, '$."profile-setup"'))    AS INTEGER),
			CAST(strftime('%s', json_extract(onboarding_progress, '$."puckstack-signup"')) AS INTEGER),
			CAST(strftime('%s', json_extract(onboarding_progress, '$."discord-connect"'))  AS INTEGER)
		) AS INTEGER
	),
	updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE onboarding_completed_at IS NULL
	AND onboarding_progress IS NOT NULL
	AND json_extract(onboarding_progress, '$."manifesto-sign"')   IS NOT NULL
	AND json_extract(onboarding_progress, '$."profile-setup"')    IS NOT NULL
	AND json_extract(onboarding_progress, '$."puckstack-signup"') IS NOT NULL
	AND json_extract(onboarding_progress, '$."discord-connect"')  IS NOT NULL;

COMMIT;
