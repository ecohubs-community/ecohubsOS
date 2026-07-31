import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { backfillMemberGroup } from '$lib/server/membership-backfill';

// POST — one-time (idempotent) backfill putting every active account into the
// "EcoHubs Member" Authentik group. Admin only. Safe to re-run.
//
// Body: { dryRun?: boolean } — dryRun reports what would change without writing.
//
// Must be run (and verified) before the member-level capability gates ship,
// since a trial member is defined by the absence of a role group.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	let dryRun = false;
	try {
		const body = await request.json();
		dryRun = body?.dryRun === true;
	} catch {
		// No body is fine — default to a real run.
	}

	const result = await backfillMemberGroup(locals.user!.id, dryRun);

	return json({ success: result.failed.length === 0, dryRun, ...result });
};
