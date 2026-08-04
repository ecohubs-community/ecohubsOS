import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { resolveReview, type Resolution } from '$lib/server/membership-review-service';

// POST /api/membership-reviews/[id] — resolve a pending review.
// Body: { resolution: 'apply' | 'dismiss', note?: string }
//
// This is the only path by which an inactivity timer changes a membership, and
// it always has a steward or admin behind it.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	requireCapability('membership.exit', locals);
	if (!params.id) error(400, 'Review ID required');

	let body: { resolution?: string; note?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (body.resolution !== 'apply' && body.resolution !== 'dismiss') {
		error(400, 'resolution must be "apply" or "dismiss"');
	}

	const result = await resolveReview(
		params.id,
		body.resolution as Resolution,
		locals.user.id,
		typeof body.note === 'string' ? body.note : undefined
	);

	if (!result.ok) error(404, result.error ?? 'Could not resolve review');

	return json({ success: true, warnings: result.warnings ?? [] });
};
