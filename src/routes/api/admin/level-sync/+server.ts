import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { syncOffcoinLevels } from '$lib/server/level-sync';

// POST — read every linked member's level from Offcoin into the local snapshot.
// Admin only. Idempotent: re-running just refreshes.
//
// Body: { dryRun?: boolean } — dryRun reads and reports without writing.
//
// The interesting field is `members`, sorted lowest level first, with
// `belowMemberLevel` marking anyone holding the Member group while under the
// level that earns it. That flag is a list to look at, not a verdict: the
// membership backfill grandfathered people in on purpose.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	let dryRun = false;
	try {
		const body = await request.json();
		dryRun = body?.dryRun === true;
	} catch {
		// No body is fine — default to a real run.
	}

	const result = await syncOffcoinLevels(locals.user!.id, dryRun);

	return json({ success: result.failed.length === 0, dryRun, ...result });
};
