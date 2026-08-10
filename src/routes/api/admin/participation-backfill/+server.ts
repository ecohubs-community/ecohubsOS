import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { backfillParticipation } from '$lib/server/participation-backfill';

// POST — one-time (idempotent) seeding of `lastParticipationAt` from each
// account's most recent session. Admin only. Safe to re-run.
//
// Body: { dryRun?: boolean } — dryRun reports what would change without writing.
//
// Run the dry run first and read `seededMembers`: the dates it reports are what
// the inactivity timers will measure from, so that list is the chance to see
// which members the review queue is about to start watching.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	let dryRun = false;
	try {
		const body = await request.json();
		dryRun = body?.dryRun === true;
	} catch {
		// No body is fine — default to a real run.
	}

	const result = await backfillParticipation(locals.user!.id, dryRun);

	return json({ success: result.failed.length === 0, dryRun, ...result });
};
