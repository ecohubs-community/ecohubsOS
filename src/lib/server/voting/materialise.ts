import { db } from '$lib/server/db';
import { proposals, proposalVotes } from '$lib/server/db/schema';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import type { ProposalType, Threshold } from './periods';
import { resolveResult, type Tallies } from './resolve';
import { sendDiscordMessage } from '$lib/server/discord';
import {
	proposalClosedApprovedMessage,
	proposalClosedRejectedMessage,
	proposalNeedsReviewMessage,
	proposalRatifiedMessage
} from '$lib/server/discord-templates';
import { votingLogger } from '$lib/server/logger';

type ProposalRow = typeof proposals.$inferSelect;

type Status = ProposalRow['status'];

const TERMINAL_STATUSES: Status[] = ['ratified', 'withdrawn'];

function parseChoices(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

async function tallyVotes(proposalId: string): Promise<Tallies> {
	const rows = await db
		.select({ choice: proposalVotes.choice, n: sql<number>`count(*)` })
		.from(proposalVotes)
		.where(eq(proposalVotes.proposalId, proposalId))
		.groupBy(proposalVotes.choice);
	const tallies: Tallies = {};
	for (const r of rows) tallies[r.choice] = Number(r.n);
	return tallies;
}

async function notifyTransition(
	proposal: ProposalRow,
	newStatus: Status,
	result: ProposalRow['result']
): Promise<void> {
	const key = result ? `${newStatus}:${result}` : newStatus;

	let message: string | null = null;
	if (newStatus === 'closed' || newStatus === 'ratifying') {
		if (result === 'approved') message = proposalClosedApprovedMessage({ title: proposal.title });
		else if (result === 'rejected' || result === 'tied')
			message = proposalClosedRejectedMessage({ title: proposal.title });
		else if (result === 'needs_review')
			message = proposalNeedsReviewMessage({ title: proposal.title });
	} else if (newStatus === 'ratified') {
		message = proposalRatifiedMessage({ title: proposal.title });
	}

	if (!message) return;

	// Atomic claim: append the key only if it isn't already present.
	// `changes` > 0 ⇒ this caller won the race and should send the message.
	// Concurrent callers see `changes === 0` and skip the send.
	const claim = await db
		.update(proposals)
		.set({
			discordNotifiedTransitions: sql`json_insert(${proposals.discordNotifiedTransitions}, '$[#]', ${key})`
		})
		.where(
			and(
				eq(proposals.id, proposal.id),
				sql`not exists (select 1 from json_each(${proposals.discordNotifiedTransitions}) where json_each.value = ${key})`
			)
		)
		.returning({ id: proposals.id });

	if (claim.length === 0) return;

	try {
		await sendDiscordMessage({ content: message });
	} catch (err) {
		votingLogger.error({ err, proposalId: proposal.id }, 'Discord notification failed');
	}
}

/**
 * Advance a proposal's status through deliberating → active → closed → ratifying → ratified
 * based on its timestamps. Returns the (possibly updated) row.
 *
 * Idempotent: re-running on a row that's already in the right status is a no-op.
 */
export async function materialiseProposal(
	row: ProposalRow,
	now: Date = new Date()
): Promise<ProposalRow> {
	if (TERMINAL_STATUSES.includes(row.status)) return row;

	let next: ProposalRow = row;
	const t = now.getTime();

	// deliberating → active
	if (next.status === 'deliberating' && next.voteOpensAt.getTime() <= t) {
		const [updated] = await db
			.update(proposals)
			.set({ status: 'active' })
			.where(eq(proposals.id, next.id))
			.returning();
		next = updated;
	}

	// active → closed (resolve result)
	if (next.status === 'active' && next.voteClosesAt.getTime() <= t) {
		const tallies = await tallyVotes(next.id);
		const choices = parseChoices(next.choices);
		const result = resolveResult(tallies, choices, next.threshold as Threshold);

		// Constitutional approved → ratifying; everyone else (or non-approved) → closed
		const constitutionalApproved =
			result === 'approved' && (next.type as ProposalType) === 'constitutional';
		const newStatus: Status = constitutionalApproved ? 'ratifying' : 'closed';

		const [updated] = await db
			.update(proposals)
			.set({ status: newStatus, result })
			.where(eq(proposals.id, next.id))
			.returning();
		next = updated;
		await notifyTransition(next, newStatus, result);
	}

	// ratifying → ratified
	if (
		next.status === 'ratifying' &&
		next.ratificationEndsAt &&
		next.ratificationEndsAt.getTime() <= t
	) {
		const [updated] = await db
			.update(proposals)
			.set({ status: 'ratified' })
			.where(eq(proposals.id, next.id))
			.returning();
		next = updated;
		await notifyTransition(next, 'ratified', next.result);
	}

	return next;
}

/**
 * Sweep all proposals whose timestamps imply a pending transition and materialise them.
 * Called from the GET /api/proposals* handlers so the system is self-healing
 * without requiring cron infrastructure.
 */
export async function materialiseAllStale(now: Date = new Date()): Promise<void> {
	const stale = await db
		.select()
		.from(proposals)
		.where(
			or(
				and(eq(proposals.status, 'deliberating'), lte(proposals.voteOpensAt, now)),
				and(eq(proposals.status, 'active'), lte(proposals.voteClosesAt, now)),
				and(eq(proposals.status, 'ratifying'), lte(proposals.ratificationEndsAt, now))
			)
		);

	for (const row of stale) {
		try {
			await materialiseProposal(row, now);
		} catch (err) {
			votingLogger.error({ err, proposalId: row.id }, 'materialise sweep failed');
		}
	}
}
