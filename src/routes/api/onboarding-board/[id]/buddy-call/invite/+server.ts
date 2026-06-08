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

// POST — record (and optionally send) the buddy-call invitation.
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
			emailLogger.error({ err, to: row.email }, 'Failed to send buddy-call invite');
			error(500, `Failed to send invite: ${err instanceof Error ? err.message : 'Unknown'}`);
		}
	}

	const now = new Date();
	await db
		.update(memberOnboarding)
		.set({ buddyCallInvitedAt: now, buddyCallInvitedBy: locals.user!.id, updatedAt: now })
		.where(eq(memberOnboarding.id, row.id));

	await addEvent(
		row.id,
		'buddy_call_invited',
		mode === 'send' ? 'Buddy-call invitation sent' : 'Buddy-call invitation marked as sent',
		locals.user!.id
	);

	apiLogger.info({ onboardingId: row.id, mode }, 'Buddy-call invite recorded');
	return json({ success: true, buddyCallInvitedAt: now.toISOString() });
};
