import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addEvent } from '$lib/server/member-onboarding/service';
import { sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';

// POST — set a member aside as unresponsive ("No response" lane), or reactivate.
// Body: { dormant: boolean, reason?: string }
// Non-destructive: nothing is deleted, the card simply parks out of the active
// flow and stops generating reminder pressure / badge counts.
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { dormant, reason } = await request.json();
	const setting = dormant !== false; // default to setting dormant
	const reasonClean = reason ? sanitizeString(String(reason), 300) : null;

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({
			dormantAt: setting ? now : null,
			dormantBy: setting ? locals.user!.id : null,
			// Dormant and standby are mutually exclusive — clear standby when setting aside.
			...(setting ? { standbyAt: null, standbyBy: null, standbyUntil: null } : {}),
			updatedAt: now
		})
		.where(eq(memberOnboarding.id, row.id));

	await addEvent(
		row.id,
		setting ? 'set_dormant' : 'reactivated',
		setting
			? `Set aside — no response${reasonClean ? ` — ${reasonClean}` : ''}`
			: 'Reactivated into the onboarding flow',
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id, setting }, 'Dormant status toggled');
	return json({ success: true, dormantAt: setting ? now.toISOString() : null });
};
