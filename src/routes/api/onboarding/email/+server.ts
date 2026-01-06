import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendEmail } from '$lib/email';
import { isValidEmail, sanitizeString, MAX_LENGTHS } from '$lib/server/validation';
import { emailLogger } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, locals }) => {
	// Require authentication for sending emails
	if (!locals.user) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	try {
		const payload = await request.json();

		// Validate required fields
		if (!payload || !payload.to || !payload.subject || (!payload.text && !payload.html)) {
			return json({ error: 'Invalid email payload' }, { status: 400 });
		}

		// Validate email recipient(s)
		const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
		for (const recipient of recipients) {
			if (!isValidEmail(recipient)) {
				return json({ error: `Invalid email address: ${recipient}` }, { status: 400 });
			}
		}

		// Validate subject length
		if (typeof payload.subject !== 'string' || payload.subject.length > 200) {
			return json({ error: 'Subject must be a string under 200 characters' }, { status: 400 });
		}

		// Validate content length
		if (payload.text && payload.text.length > MAX_LENGTHS.text) {
			return json({ error: 'Email content too long' }, { status: 400 });
		}

		// Sanitize subject
		const sanitizedSubject = sanitizeString(payload.subject, 200);

		await sendEmail({
			to: payload.to,
			subject: sanitizedSubject,
			text: payload.text || '',
			html: payload.html || '<p></p>',
			replyTo: payload.replyTo
		});

		return json({ ok: true });
	} catch (err) {
		emailLogger.error({ err }, 'Onboarding email send failed');
		return json({ error: 'Email send failed' }, { status: 500 });
	}
};
