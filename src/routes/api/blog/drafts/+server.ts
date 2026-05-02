import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllGhostDrafts } from '$lib/server/ghost';
import { db } from '$lib/server/db';
import { proposals, proposalVotes } from '$lib/server/db/schema';
import { inArray, sql } from 'drizzle-orm';
import { materialiseAllStale } from '$lib/server/voting/materialise';

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

// GET - List all blog drafts with proposal status.
// Status is enriched from the local proposals table (linkedBlogDraftId).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	try {
		await materialiseAllStale();

		const drafts = await getAllGhostDrafts();
		const draftIds = drafts.map((d) => d.id);

		const linkedProposals = draftIds.length
			? await db
					.select()
					.from(proposals)
					.where(inArray(proposals.linkedBlogDraftId, draftIds))
			: [];

		const proposalIds = linkedProposals.map((p) => p.id);
		const tallies = proposalIds.length
			? await db
					.select({
						proposalId: proposalVotes.proposalId,
						choice: proposalVotes.choice,
						n: sql<number>`count(*)`
					})
					.from(proposalVotes)
					.where(inArray(proposalVotes.proposalId, proposalIds))
					.groupBy(proposalVotes.proposalId, proposalVotes.choice)
			: [];

		const tallyByProposal = new Map<string, Record<string, number>>();
		for (const r of tallies) {
			const m = tallyByProposal.get(r.proposalId) ?? {};
			m[r.choice] = Number(r.n);
			tallyByProposal.set(r.proposalId, m);
		}

		const proposalByDraft = new Map<string, (typeof linkedProposals)[number]>();
		for (const p of linkedProposals) {
			if (p.linkedBlogDraftId) proposalByDraft.set(p.linkedBlogDraftId, p);
		}

		const draftsWithProposals: DraftWithProposal[] = drafts.map((draft) => {
			const proposal = proposalByDraft.get(draft.id);

			let proposalId: string | null = null;
			let proposalStatus: 'none' | 'active' | 'closed' = 'none';
			let isApproved = false;
			let proposalEnd: number | undefined;

			if (proposal) {
				proposalId = proposal.id;
				if (proposal.status === 'active' || proposal.status === 'deliberating') {
					proposalStatus = 'active';
				} else if (
					proposal.status === 'closed' ||
					proposal.status === 'ratifying' ||
					proposal.status === 'ratified'
				) {
					proposalStatus = 'closed';
					isApproved = proposal.result === 'approved';
				}
				proposalEnd = Math.floor(proposal.voteClosesAt.getTime() / 1000);
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
		});

		return json({ drafts: draftsWithProposals });
	} catch (err) {
		console.error('Error fetching blog drafts:', err);
		error(500, 'Failed to fetch blog drafts');
	}
};
