import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { closeCase } from '$lib/server/membership-cases';

// POST /api/membership/cases/[id] — withdraw or dismiss an open case.
// Body: { outcome: 'withdrawn' | 'dismissed' }
//
// Restores whatever status the member held before the suspension and withdraws
// the vote, so the community is not left deciding something already settled.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	requireCapability('membership.exit', locals);
	if (!params.id) error(400, 'Case ID required');

	let body: { outcome?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (body.outcome !== 'withdrawn' && body.outcome !== 'dismissed') {
		error(400, 'outcome must be "withdrawn" or "dismissed"');
	}

	const result = await closeCase(params.id, locals.user.id, body.outcome);
	if (!result.ok) error(404, result.error ?? 'Could not close case');

	return json({ success: true });
};
