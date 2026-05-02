import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGhostDraft, publishGhostPost } from '$lib/server/ghost';
import { db } from '$lib/server/db';
import { proposals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { materialiseProposal } from '$lib/server/voting/materialise';

// POST - Publish a draft whose linked voting proposal has closed with an approval.
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const draftId = params.id;
	if (!draftId) {
		error(400, 'Draft ID is required');
	}

	try {
		const draft = await getGhostDraft(draftId);
		if (!draft) {
			error(404, 'Draft not found');
		}

		const [linkedProposal] = await db
			.select()
			.from(proposals)
			.where(eq(proposals.linkedBlogDraftId, draftId));

		if (!linkedProposal) {
			error(400, 'No proposal found for this draft');
		}

		const proposal = await materialiseProposal(linkedProposal);

		const closedStatuses = ['closed', 'ratifying', 'ratified'] as const;
		if (!closedStatuses.includes(proposal.status as (typeof closedStatuses)[number])) {
			error(400, 'Proposal voting is still active');
		}

		if (proposal.result !== 'approved') {
			error(400, 'Proposal was not approved for publication');
		}

		const publishedPost = await publishGhostPost(draftId);
		if (!publishedPost) {
			error(500, 'Failed to publish draft');
		}

		return json({
			success: true,
			post: {
				id: publishedPost.id,
				slug: publishedPost.slug,
				title: publishedPost.title,
				published_at: publishedPost.published_at
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error publishing draft:', err);
		error(500, 'Failed to publish draft');
	}
};
