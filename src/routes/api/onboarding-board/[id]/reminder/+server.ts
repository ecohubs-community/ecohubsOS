import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from '$lib/email';
import { renderBrandedEmailHtml } from '$lib/server/member-onboarding/emailTemplates';
import { addEvent } from '$lib/server/member-onboarding/service';
import { apiLogger, emailLogger } from '$lib/server/logger';

// POST — record (and optionally send) the manual login reminder.
// Body: { mode: 'send' | 'mark', subject?, body? }
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { mode, subject, body } = await request.json();
	if (mode !== 'send' && mode !== 'mark') error(400, 'mode must be "send" or "mark"');

	if (mode === 'send') {
		if (!subject?.trim() || !body?.trim()) error(400, 'subject and body are required to send');
		try {
			await sendEmail({
				to: row.email,
				subject: subject.trim(),
				text: body,
				html: renderBrandedEmailHtml(body)
			});
		} catch (err) {
			emailLogger.error({ err, to: row.email }, 'Failed to send reminder email');
			error(500, `Failed to send reminder: ${err instanceof Error ? err.message : 'Unknown'}`);
		}
	}

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({ reminderSentAt: now, reminderSentBy: locals.user!.id, updatedAt: now })
		.where(eq(memberOnboarding.id, row.id));

	await addEvent(
		row.id,
		'reminder_sent',
		mode === 'send' ? 'Reminder email sent' : 'Reminder marked as sent (sent manually)',
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id, mode }, 'Reminder recorded');
	return json({ success: true, reminderSentAt: now.toISOString() });
};
