import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGhostDraft, publishGhostPost } from '$lib/server/ghost';
import { isProposalApproved, getProposalStatus, getProposalForDraft } from '$lib/server/blog-snapshot';

// POST - Publish a draft that has an approved Snapshot proposal
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const draftId = params.id;
	if (!draftId) {
		error(400, 'Draft ID is required');
	}

	try {
		// Fetch the draft
		const draft = await getGhostDraft(draftId);
		if (!draft) {
			error(404, 'Draft not found');
		}

		// Check if draft has a proposal ID in custom fields
		const customFields = draft.custom_fields as Record<string, unknown> | undefined;
		let proposalId: string | null = null;

		const proposalIdFromFields = customFields?.snapshot_proposal_id;
		if (typeof proposalIdFromFields === 'string') {
			proposalId = proposalIdFromFields;
		}

		// Fallback: try to find proposal by title pattern if not in custom fields
		if (!proposalId) {
			proposalId = await getProposalForDraft(draft.title, draft.slug);
		}

		if (!proposalId) {
			error(400, 'No proposal found for this draft');
		}

		// Check proposal status
		const status = await getProposalStatus(proposalId);
		if (!status) {
			error(400, 'Could not fetch proposal status');
		}

		if (status.status !== 'closed') {
			error(400, 'Proposal voting is still active');
		}

		// Check if proposal was approved
		const approved = await isProposalApproved(proposalId);
		if (!approved) {
			error(400, 'Proposal was not approved for publication');
		}

		// Publish the draft
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
