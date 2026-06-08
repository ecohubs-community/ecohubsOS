import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { backfillOnboardingRows } from '$lib/server/member-onboarding/service';

// POST — one-time (idempotent) backfill of onboarding rows for existing
// approved members. Admin only. Safe to re-run.
export const POST: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	const created = await backfillOnboardingRows();
	return json({ success: true, created });
};
