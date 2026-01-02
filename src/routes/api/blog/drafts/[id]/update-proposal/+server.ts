import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateGhostPostCustomFields, getGhostDraft } from '$lib/server/ghost';

// POST - Update a draft with its Snapshot proposal ID
export const POST: RequestHandler = async ({ request, locals, params }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const draftId = params.id;
	if (!draftId) {
		error(400, 'Draft ID is required');
	}

	try {
		const { proposalId } = await request.json();

		if (!proposalId || typeof proposalId !== 'string') {
			error(400, 'Proposal ID is required');
		}

		// Verify the draft exists
		const draft = await getGhostDraft(draftId);
		if (!draft) {
			error(404, 'Draft not found');
		}

		// Update the draft with the proposal ID in custom fields
		await updateGhostPostCustomFields(draftId, {
			snapshot_proposal_id: proposalId
		});

		return json({
			success: true,
			proposalId
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error updating draft proposal:', err);
		error(500, 'Failed to update draft with proposal ID');
	}
};
