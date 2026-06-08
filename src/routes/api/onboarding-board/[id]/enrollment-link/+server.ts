import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createAuthentikInvitation } from '$lib/server/authentik';
import { buildReminderTemplate } from '$lib/server/member-onboarding/emailTemplates';
import { apiLogger } from '$lib/server/logger';

// GET — generate a fresh Authentik enrollment link and a pre-filled reminder
// template for the composer. Each call mints a new single-use invitation.
export const GET: RequestHandler = async ({ params, locals }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	let enrollmentUrl: string;
	try {
		const result = await createAuthentikInvitation(row.fullName, row.email);
		enrollmentUrl = result.enrollmentUrl;
	} catch (err) {
		apiLogger.error({ err, onboardingId: row.id }, 'Failed to regenerate enrollment link');
		error(500, `Failed to create enrollment link: ${err instanceof Error ? err.message : 'Unknown'}`);
	}

	const template = buildReminderTemplate({
		recipientName: row.fullName,
		senderName: locals.user!.name,
		enrollmentUrl
	});

	return json({ enrollmentUrl, template });
};
