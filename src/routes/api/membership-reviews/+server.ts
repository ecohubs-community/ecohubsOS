import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import {
	listPendingReviews,
	materialiseMembershipReviews
} from '$lib/server/membership-review-service';
import { sendDueWarnings } from '$lib/server/membership-warnings';
import { syncPuckstackActivity } from '$lib/server/puckstack-activity';

// GET /api/membership-reviews — pending membership downgrades awaiting a
// decision. Stewards and admins only.
//
// Evaluates the timers on read, the same lazy idiom as materialiseProposal —
// there is no scheduler in this app. The evaluation only ever *queues*
// proposals; nothing here changes a membership.
export const GET: RequestHandler = async ({ locals }) => {
	requireCapability('membership.exit', locals);

	// Puckstack first. Proposing to exit someone whose task activity we had not
	// checked would be exactly the wrong mistake, so the evidence is refreshed
	// before anything is warned or proposed.
	const synced = await syncPuckstackActivity();

	// Warnings next: a member should hear their membership is about to change
	// before it appears in this queue, not after.
	const warned = await sendDueWarnings();
	const created = await materialiseMembershipReviews();
	const reviews = await listPendingReviews();

	return json({ reviews, created, warned, synced });
};
