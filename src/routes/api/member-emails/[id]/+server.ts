import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { dismissQueuedEmail, sendQueuedEmail } from '$lib/server/member-email-queue';

// POST /api/member-emails/[id] — send or dismiss a draft.
// Body: { action: 'send' | 'dismiss', subject?, body?, reason? }
//
// `subject` and `body` let a steward reword before sending, which is the point:
// the system drafts, a person decides what actually goes.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	requireCapability('onboarding.manage', locals);
	if (!params.id) error(400, 'Draft ID required');

	let body: { action?: string; subject?: string; body?: string; reason?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (body.action === 'send') {
		const result = await sendQueuedEmail(params.id, locals.user.id, {
			subject: body.subject,
			body: body.body
		});
		// A delivery failure leaves the draft pending so it can be retried; the
		// steward's edit is already saved either way.
		if (!result.ok) error(502, result.error ?? 'Could not send');
		return json({ success: true });
	}

	if (body.action === 'dismiss') {
		const result = await dismissQueuedEmail(params.id, locals.user.id, body.reason);
		if (!result.ok) error(404, result.error ?? 'Could not dismiss');
		return json({ success: true });
	}

	error(400, 'action must be "send" or "dismiss"');
};
