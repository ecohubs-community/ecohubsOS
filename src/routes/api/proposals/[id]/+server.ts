import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	applications,
	proposals,
	proposalVotes,
	user as userTable
} from '$lib/server/db/schema';
import { asc, eq } from 'drizzle-orm';
import { materialiseProposal } from '$lib/server/voting/materialise';
import { getMembershipVisibility } from '$lib/server/membership-visibility';

function parseTags(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function parseChoices(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

// GET /api/proposals/[id] — proposal detail with full voter list and tally.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!params.id) error(400, 'Proposal ID required');

	const [row] = await db.select().from(proposals).where(eq(proposals.id, params.id));
	if (!row) error(404, 'Proposal not found');

	// Non-admin members may only see a membership vote if its linked application
	// was submitted after their own. Non-membership proposals are always visible.
	if (row.linkedApplicationId) {
		const vis = await getMembershipVisibility(locals);
		if (vis.restricted) {
			const [app] = await db
				.select({ submittedAt: applications.submittedAt, email: applications.email })
				.from(applications)
				.where(eq(applications.id, row.linkedApplicationId))
				.limit(1);
			if (
				!app ||
				!(app.submittedAt > (vis.cutoff as string) && app.email.toLowerCase() !== vis.email)
			) {
				error(404, 'Proposal not found');
			}
		}
	}

	const proposal = await materialiseProposal(row);

	const votes = await db
		.select({
			userId: proposalVotes.userId,
			choice: proposalVotes.choice,
			reason: proposalVotes.reason,
			votedAt: proposalVotes.votedAt,
			name: userTable.name,
			displayName: userTable.displayName
		})
		.from(proposalVotes)
		.leftJoin(userTable, eq(proposalVotes.userId, userTable.id))
		.where(eq(proposalVotes.proposalId, proposal.id))
		.orderBy(asc(proposalVotes.votedAt));

	const tallies: Record<string, number> = {};
	for (const v of votes) tallies[v.choice] = (tallies[v.choice] ?? 0) + 1;
	const votesTotal = votes.length;

	const voters = votes.map((v) => ({
		userId: v.userId,
		displayName: v.displayName || v.name || 'Member',
		choice: v.choice,
		reason: v.reason,
		votedAt: v.votedAt
	}));

	const userHasVoted = voters.some((v) => v.userId === locals.user!.id);

	// Surface the admin's cancellation reason on withdrawn application proposals.
	let withdrawalReason: string | null = null;
	let withdrawnAt: string | null = null;
	if (proposal.status === 'withdrawn' && proposal.linkedApplicationId) {
		const [app] = await db
			.select({
				cancellationReason: applications.cancellationReason,
				cancelledAt: applications.cancelledAt
			})
			.from(applications)
			.where(eq(applications.id, proposal.linkedApplicationId));
		if (app) {
			withdrawalReason = app.cancellationReason;
			withdrawnAt = app.cancelledAt;
		}
	}

	return json({
		proposal: {
			id: proposal.id,
			type: proposal.type,
			title: proposal.title,
			body: proposal.body,
			motion: proposal.motion,
			tags: parseTags(proposal.tags),
			choiceSetKey: proposal.choiceSetKey,
			choices: parseChoices(proposal.choices),
			threshold: proposal.threshold,
			status: proposal.status,
			result: proposal.result,
			authorUserId: proposal.authorUserId,
			createdAt: proposal.createdAt,
			voteOpensAt: proposal.voteOpensAt,
			voteClosesAt: proposal.voteClosesAt,
			ratificationEndsAt: proposal.ratificationEndsAt,
			linkedApplicationId: proposal.linkedApplicationId,
			linkedBlogDraftId: proposal.linkedBlogDraftId,
			votesByChoice: tallies,
			votesTotal,
			userHasVoted,
			voters,
			withdrawalReason,
			withdrawnAt
		}
	});
};
