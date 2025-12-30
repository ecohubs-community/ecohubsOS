import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendEmail } from '$lib/email';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const payload = await request.json();
		if (!payload || !payload.to || !payload.subject || (!payload.text && !payload.html)) {
			return json({ error: 'Invalid email payload' }, { status: 400 });
		}

		await sendEmail({
			to: payload.to,
			subject: payload.subject,
			text: payload.text || '',
			html: payload.html || '<p></p>',
			replyTo: payload.replyTo
		});

		return json({ ok: true });
	} catch (err) {
		console.error('Onboarding email send failed:', err);
		return json({ error: 'Email send failed' }, { status: 500 });
	}
};
