import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { proposals, proposalVotes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { materialiseProposal } from '$lib/server/voting/materialise';
import { votingLogger } from '$lib/server/logger';
import { checkRateLimit, PROPOSAL_VOTE_RATE_LIMIT } from '$lib/server/rateLimit';

const REASON_MAX = 1_000;

function parseChoices(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

// POST /api/proposals/[id]/vote — cast a vote.
// Eligibility: any authenticated user (no Offcoin/wallet dependency).
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!params.id) error(400, 'Proposal ID required');

	if (!checkRateLimit(PROPOSAL_VOTE_RATE_LIMIT, locals.user.id)) {
		error(429, 'Too many vote attempts — please slow down');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}
	const { choice, reason } = body as { choice?: string; reason?: string };

	if (typeof choice !== 'string' || choice.length === 0) error(400, 'Choice is required');
	if (reason !== undefined && reason !== null) {
		if (typeof reason !== 'string') error(400, 'Reason must be a string');
		if (reason.length > REASON_MAX) error(400, `Reason must be ≤ ${REASON_MAX} characters`);
	}

	const [row] = await db.select().from(proposals).where(eq(proposals.id, params.id));
	if (!row) error(404, 'Proposal not found');

	// Materialise just-in-time so a vote arriving exactly at vote-open time succeeds
	// and one arriving at vote-close time is rejected.
	const proposal = await materialiseProposal(row);

	if (proposal.status !== 'active') {
		error(409, `Voting is not open (status: ${proposal.status})`);
	}

	const choices = parseChoices(proposal.choices);
	if (!choices.includes(choice)) error(400, 'Invalid choice for this proposal');

	const trimmedReason = reason?.trim() || null;

	try {
		const [vote] = await db
			.insert(proposalVotes)
			.values({
				proposalId: proposal.id,
				userId: locals.user.id,
				choice,
				reason: trimmedReason
			})
			.returning();

		votingLogger.info(
			{ proposalId: proposal.id, userId: locals.user.id, choice },
			'vote cast'
		);

		return json({ vote });
	} catch (err) {
		// Unique-index violation on (proposalId, userId)
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('UNIQUE') || message.includes('unique')) {
			error(409, 'You have already voted on this proposal');
		}
		votingLogger.error({ err, proposalId: proposal.id, userId: locals.user.id }, 'vote failed');
		error(500, 'Failed to record vote');
	}
};
