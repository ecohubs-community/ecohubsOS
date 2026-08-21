import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { backfillWayfinderRewards } from '$lib/server/wayfinder-backfill';

// POST — pays the welcome video's ECO and XP to members who watched it before
// Wayfinder rewards existed. Admin only. Safe to re-run: the reward claim on
// each watch row means a second run pays nobody.
//
// Body: { dryRun?: boolean } — dryRun reports what would move without writing.
//
// **Run the dry run first.** This moves real tokens into real balances, and XP
// decides when a trial member becomes a full one — so `recipients`, `totalEco`
// and `totalXp` are the last chance to check who is about to be paid and how
// much, while it is still reversible by simply not running it.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	let dryRun = false;
	try {
		const body = await request.json();
		dryRun = body?.dryRun === true;
	} catch {
		// No body is fine — default to a real run.
	}

	const result = await backfillWayfinderRewards(locals.user!.id, dryRun);

	return json({ success: result.failed.length === 0, dryRun, ...result });
};
