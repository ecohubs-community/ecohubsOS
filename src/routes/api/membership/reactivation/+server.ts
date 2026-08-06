import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReactivationStatus, requestReactivation } from '$lib/server/membership-reactivation';

// GET /api/membership/reactivation — the caller's own reactivation status.
//
// Exists because getMembershipVisibility deliberately hides a member's own
// membership vote from them: they cannot watch it through /api/proposals. This
// tells them only what they are entitled to know — that a request exists, and
// how it ended. Never the voters or their reasons.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const status = await getReactivationStatus(locals.user.id, locals.user.email);
	return json(status);
};

// POST /api/membership/reactivation — open a reactivation request.
// Body: { reason: string }
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	let body: { reason?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (typeof body.reason !== 'string') error(400, 'A reason is required');

	const result = await requestReactivation(locals.user.id, body.reason);
	if (!result.ok) error(400, result.error ?? 'Could not submit request');

	return json({ success: true });
};
