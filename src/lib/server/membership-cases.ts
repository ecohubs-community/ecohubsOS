/**
 * Disciplinary cases.
 *
 * The shape of this is a deliberate governance decision: **a steward can
 * suspend, only the community can remove.**
 *
 * Opening a case moves the member to standby immediately — protective,
 * reversible, and available without waiting three days for a vote, because the
 * situations that warrant a case are often ones where waiting causes further
 * harm. Making it permanent needs a majority of active members.
 *
 * The evidence never reaches the ballot. Voters see a summary the steward
 * writes; the notes stay with stewards. Cases usually involve someone who was
 * harmed, and putting their account in front of the whole community would make
 * reporting something a cost the reporter pays.
 */

import { db } from '$lib/server/db';
import {
	membershipCases,
	membershipEvents,
	proposals,
	user as userTable
} from '$lib/server/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { POLICY, type MembershipStatus } from '$lib/policy';
import { createSystemProposal } from '$lib/server/voting/system-proposal';
import { executeExit } from '$lib/server/membership-exit';
import { apiLogger } from '$lib/server/logger';

/** Statuses meaning the case is still being decided. */
export const OPEN_CASE_STATUSES = ['voting', 'needs_review'] as const;

export interface OpenCaseInput {
	userId: string;
	publicSummary: string;
	privateNotes?: string;
	openedBy: string;
}

/**
 * Open a case: suspend now, put removal to the community.
 *
 * Refuses if the member already has an open case — two concurrent votes on the
 * same person would be incoherent — or if they have already exited.
 */
export async function openCase(
	input: OpenCaseInput
): Promise<{ ok: boolean; error?: string; caseId?: string; proposalId?: string }> {
	const summary = input.publicSummary.trim();
	if (summary.length < 20) {
		return { ok: false, error: 'Please write a summary of at least 20 characters for voters' };
	}

	const member = await db.query.user.findFirst({ where: eq(userTable.id, input.userId) });
	if (!member) return { ok: false, error: 'Member not found' };
	if (member.membershipStatus === 'exited') {
		return { ok: false, error: 'This member has already left' };
	}

	const existing = await db
		.select({ id: membershipCases.id })
		.from(membershipCases)
		.where(
			and(
				eq(membershipCases.userId, input.userId),
				inArray(membershipCases.status, [...OPEN_CASE_STATUSES])
			)
		)
		.limit(1);
	if (existing.length > 0) {
		return { ok: false, error: 'This member already has an open case' };
	}

	const previousStatus = (member.membershipStatus ?? 'active') as MembershipStatus;
	const displayName = member.displayName?.trim() || member.name;
	const now = new Date();

	// Suspend first. If the proposal creation below fails, the protective action
	// has still taken effect — the safer half to land.
	await db
		.update(userTable)
		.set({
			membershipStatus: 'standby',
			membershipStatusSince: now,
			standbyReason: 'Suspended pending a community decision',
			updatedAt: now
		})
		.where(eq(userTable.id, input.userId));

	await db.insert(membershipEvents).values({
		userId: input.userId,
		fromStatus: previousStatus,
		toStatus: 'standby',
		reason: `Disciplinary case opened: ${summary}`,
		actorUserId: input.openedBy
	});

	const [row] = await db
		.insert(membershipCases)
		.values({
			userId: input.userId,
			openedBy: input.openedBy,
			publicSummary: summary,
			privateNotes: input.privateNotes?.trim() || null,
			previousStatus,
			status: 'voting'
		})
		.returning();

	const proposal = await createSystemProposal({
		type: POLICY.reactivation.proposalType,
		choiceSetKey: 'membership',
		tags: ['membership', 'conduct'],
		title: `End ${displayName}'s membership?`,
		body: [
			`A steward has opened a case about ${displayName}'s participation, and their`,
			'membership is suspended while the community decides.',
			'',
			'**Summary:**',
			'',
			summary,
			'',
			'_Approving ends their membership. Rejecting restores it. Details beyond this',
			'summary are held by the stewards, deliberately — a case often involves someone',
			'else who was affected._'
		].join('\n')
	});

	await db
		.update(membershipCases)
		.set({ proposalId: proposal.id })
		.where(eq(membershipCases.id, row.id));

	apiLogger.info(
		{ caseId: row.id, userId: input.userId, openedBy: input.openedBy },
		'Disciplinary case opened'
	);
	return { ok: true, caseId: row.id, proposalId: proposal.id };
}

/**
 * Apply the outcome of a case's vote. Called from `materialiseProposal`.
 *
 * Idempotent: it only acts on a case still in `voting`, so repeated lazy
 * materialisation cannot exit someone twice or undo a resolved case.
 *
 * Zero votes cannot remove anyone — that is handled upstream by the same
 * reactivation override, which routes an empty ballot to `needs_review`. Here,
 * `needs_review` leaves the member suspended and the case open for a steward.
 */
export async function applyCaseOutcome(proposalId: string, result: string | null): Promise<void> {
	if (!result) return;

	const [row] = await db
		.select()
		.from(membershipCases)
		.where(and(eq(membershipCases.proposalId, proposalId), eq(membershipCases.status, 'voting')))
		.limit(1);
	if (!row) return;

	const now = new Date();

	if (result === 'approved') {
		await executeExit(row.userId, `Community vote: ${row.publicSummary}`, null);
		await db
			.update(membershipCases)
			.set({ status: 'exited', resolvedAt: now })
			.where(eq(membershipCases.id, row.id));
		apiLogger.info({ caseId: row.id }, 'Disciplinary case ended membership');
		return;
	}

	if (result === 'needs_review') {
		// Inconclusive, including the zero-vote case. The member stays suspended
		// and a steward picks it up — silence must not remove someone, but nor
		// should it silently reinstate them mid-case.
		await db
			.update(membershipCases)
			.set({ status: 'needs_review' })
			.where(eq(membershipCases.id, row.id));
		return;
	}

	// Rejected or tied — the community declined to remove them, so the
	// suspension lifts and they go back to where they were.
	await restoreMember(row.userId, row.previousStatus, 'Community vote declined removal', null);
	await db
		.update(membershipCases)
		.set({ status: 'dismissed', resolvedAt: now })
		.where(eq(membershipCases.id, row.id));
	apiLogger.info({ caseId: row.id }, 'Disciplinary case dismissed by vote');
}

/**
 * Withdraw or dismiss an open case by hand.
 *
 * A steward may realise the case was opened in error, or the matter may be
 * resolved between the people involved. Restores whatever status the member
 * held before.
 */
export async function closeCase(
	caseId: string,
	actorUserId: string,
	outcome: 'withdrawn' | 'dismissed'
): Promise<{ ok: boolean; error?: string }> {
	const [row] = await db
		.select()
		.from(membershipCases)
		.where(
			and(eq(membershipCases.id, caseId), inArray(membershipCases.status, [...OPEN_CASE_STATUSES]))
		)
		.limit(1);
	if (!row) return { ok: false, error: 'Case not found or already resolved' };

	await restoreMember(
		row.userId,
		row.previousStatus,
		outcome === 'withdrawn' ? 'Case withdrawn by a steward' : 'Case dismissed by a steward',
		actorUserId
	);

	await db
		.update(membershipCases)
		.set({ status: outcome, resolvedAt: new Date(), resolvedBy: actorUserId })
		.where(eq(membershipCases.id, caseId));

	// Withdraw the vote too, so the community is not left deciding something
	// that no longer needs deciding.
	if (row.proposalId) {
		await db
			.update(proposals)
			.set({ status: 'withdrawn' })
			.where(and(eq(proposals.id, row.proposalId), eq(proposals.status, 'active')));
	}

	apiLogger.info({ caseId, outcome, actorUserId }, 'Disciplinary case closed');
	return { ok: true };
}

/** Put a member back to the status they held before the case. */
async function restoreMember(
	userId: string,
	previousStatus: string,
	reason: string,
	actorUserId: string | null
): Promise<void> {
	const now = new Date();
	await db
		.update(userTable)
		.set({
			membershipStatus: previousStatus,
			membershipStatusSince: now,
			standbyReason: null,
			updatedAt: now
		})
		.where(eq(userTable.id, userId));

	await db.insert(membershipEvents).values({
		userId,
		fromStatus: 'standby',
		toStatus: previousStatus,
		reason,
		actorUserId
	});
}

/** The member's open case, if any — used to shape what /standby offers them. */
export async function getOpenCaseFor(userId: string) {
	const [row] = await db
		.select()
		.from(membershipCases)
		.where(
			and(
				eq(membershipCases.userId, userId),
				inArray(membershipCases.status, [...OPEN_CASE_STATUSES])
			)
		)
		.orderBy(desc(membershipCases.createdAt))
		.limit(1);
	return row ?? null;
}
