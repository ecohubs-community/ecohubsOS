import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import {
	listPendingReviews,
	materialiseMembershipReviews
} from '$lib/server/membership-review-service';

// GET /api/membership-reviews — pending membership downgrades awaiting a
// decision. Stewards and admins only.
//
// Evaluates the timers on read, the same lazy idiom as materialiseProposal —
// there is no scheduler in this app. The evaluation only ever *queues*
// proposals; nothing here changes a membership.
export const GET: RequestHandler = async ({ locals }) => {
	requireCapability('membership.exit', locals);

	const created = await materialiseMembershipReviews();
	const reviews = await listPendingReviews();

	return json({ reviews, created });
};
