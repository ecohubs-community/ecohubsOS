import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addEvent } from '$lib/server/member-onboarding/service';
import { sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';

// POST — log a buddy call that actually happened.
// Body: { date: ISO string, withWhom: string }
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { date, withWhom } = await request.json();
	const callDate = date ? new Date(date) : new Date();
	if (Number.isNaN(callDate.getTime())) error(400, 'Invalid date');
	const withWhomClean = withWhom ? sanitizeString(String(withWhom), 200) : null;

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({ buddyCallAt: callDate, buddyCallWith: withWhomClean, updatedAt: now })
		.where(eq(memberOnboarding.id, row.id));

	await addEvent(
		row.id,
		'buddy_call_held',
		`Buddy call held on ${callDate.toLocaleDateString()}${withWhomClean ? ` with ${withWhomClean}` : ''}`,
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id }, 'Buddy call logged');
	return json({
		success: true,
		buddyCallAt: callDate.toISOString(),
		buddyCallWith: withWhomClean
	});
};
