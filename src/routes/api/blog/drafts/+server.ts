import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getAllGhostDrafts } from '$lib/server/ghost';
import { getProposalForDraft, getProposalStatus, isProposalApproved } from '$lib/server/blog-snapshot';

export interface DraftWithProposal {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	author: string;
	updated_at: string;
	tags?: string[];
	proposalId: string | null;
	proposalStatus: 'none' | 'active' | 'closed';
	isApproved: boolean;
	proposalEnd?: number;
}

// GET - List all blog drafts with proposal status
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	try {
		// Fetch all drafts from Ghost
		const drafts = await getAllGhostDrafts();

		// Enrich drafts with proposal information
		const draftsWithProposals: DraftWithProposal[] = await Promise.all(
			drafts.map(async (draft) => {
				// Check custom fields first
				const customFields = draft.custom_fields as Record<string, unknown> | undefined;
				const proposalIdFromFields = customFields?.snapshot_proposal_id;
				let proposalId: string | null =
					typeof proposalIdFromFields === 'string' ? proposalIdFromFields : null;

				// If not in custom fields, try to find by title pattern
				if (!proposalId) {
					proposalId = await getProposalForDraft(draft.title, draft.slug);
				}

				let proposalStatus: 'none' | 'active' | 'closed' = 'none';
				let isApproved = false;
				let proposalEnd: number | undefined;

				if (proposalId) {
					const status = await getProposalStatus(proposalId);
					if (status) {
						proposalStatus = status.status;
						proposalEnd = status.end;
						if (status.status === 'closed') {
							isApproved = await isProposalApproved(proposalId);
						}
					}
				}

				return {
					id: draft.id,
					slug: draft.slug,
					title: draft.title,
					excerpt: draft.excerpt || draft.custom_excerpt || '',
					author: draft.authors?.[0]?.name || 'Unknown',
					updated_at: draft.updated_at,
					tags: draft.tags?.map((tag) => tag.name) || [],
					proposalId,
					proposalStatus,
					isApproved,
					proposalEnd
				};
			})
		);

		// Return drafts with Snapshot configuration for client-side proposal creation
		const snapshotSpace = env.SNAPSHOT_SPACE || 'ecohubs.eth';
		const votingDuration = parseInt(env.SNAPSHOT_BLOG_VOTING_DURATION || '172800', 10); // 2 days default

		return json({
			drafts: draftsWithProposals,
			snapshotSpace,
			votingDuration
		});
	} catch (err) {
		console.error('Error fetching blog drafts:', err);
		error(500, 'Failed to fetch blog drafts');
	}
};
