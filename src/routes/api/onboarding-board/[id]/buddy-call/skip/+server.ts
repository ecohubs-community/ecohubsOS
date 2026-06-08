import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addEvent } from '$lib/server/member-onboarding/service';
import { sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';

// POST — mark the buddy call as "not needed" (skip), or undo a skip.
// Body: { skip: boolean, reason?: string }
// A skipped call satisfies the buddy-call step so the member can reach Complete.
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { skip, reason } = await request.json();
	const skipping = skip !== false; // default to skipping
	const reasonClean = reason ? sanitizeString(String(reason), 300) : null;

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({
			buddyCallSkippedAt: skipping ? now : null,
			buddyCallSkippedBy: skipping ? locals.user!.id : null,
			updatedAt: now
		})
		.where(eq(memberOnboarding.id, row.id));

	await addEvent(
		row.id,
		skipping ? 'buddy_call_skipped' : 'buddy_call_unskipped',
		skipping
			? `Buddy call marked not needed${reasonClean ? ` — ${reasonClean}` : ''}`
			: 'Buddy-call skip removed',
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id, skipping }, 'Buddy-call skip toggled');
	return json({ success: true, buddyCallSkippedAt: skipping ? now.toISOString() : null });
};
