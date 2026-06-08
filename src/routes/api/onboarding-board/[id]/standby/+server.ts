import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addEvent } from '$lib/server/member-onboarding/service';
import { sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';

// POST — put an engaged member on standby (they asked to pause, will return), or
// resume them. Body: { standby: boolean, until?: ISO date, reason?: string }
// `until` is an optional follow-up date — once it passes the card flags for
// attention. Mutually exclusive with the dormant ("no response") lane.
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { standby, until, reason } = await request.json();
	const setting = standby !== false; // default to setting standby

	let untilDate: Date | null = null;
	if (setting && until) {
		untilDate = new Date(until);
		if (Number.isNaN(untilDate.getTime())) error(400, 'Invalid follow-up date');
	}
	const reasonClean = reason ? sanitizeString(String(reason), 300) : null;

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({
			standbyAt: setting ? now : null,
			standbyBy: setting ? locals.user!.id : null,
			standbyUntil: setting ? untilDate : null,
			// Standby and dormant are mutually exclusive — clear dormant when pausing.
			...(setting ? { dormantAt: null, dormantBy: null } : {}),
			updatedAt: now
		})
		.where(eq(memberOnboarding.id, row.id));

	const followUp = untilDate ? ` — follow up ${untilDate.toLocaleDateString()}` : '';
	await addEvent(
		row.id,
		setting ? 'set_standby' : 'resumed',
		setting
			? `Put on standby${reasonClean ? ` — ${reasonClean}` : ''}${followUp}`
			: 'Resumed from standby into the onboarding flow',
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id, setting }, 'Standby status toggled');
	return json({
		success: true,
		standbyAt: setting ? now.toISOString() : null,
		standbyUntil: untilDate?.toISOString() ?? null
	});
};
