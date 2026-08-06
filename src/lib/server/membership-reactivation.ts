/**
 * Reactivation from standby.
 *
 * A standby member writes a reason; that becomes an `applications` row of type
 * `reactivation` plus a system-authored operational proposal — already exactly
 * a 3-day majority vote with no deliberation or ratification phase, so no new
 * voting configuration is needed.
 *
 * The member cannot author the proposal themselves (`proposal.create` is
 * steward-gated) and cannot vote on it (`proposal.vote` requires active), so
 * both go through the system path here.
 */

import { db } from '$lib/server/db';
import { applications, proposals, user as userTable } from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { POLICY } from '$lib/policy';
import { createSystemProposal } from '$lib/server/voting/system-proposal';
import { apiLogger } from '$lib/server/logger';

const DAY_MS = 86_400_000;

export interface ReactivationStatus {
	/** The member's own pending or most recent request, if any. */
	requestId: string | null;
	proposalId: string | null;
	state: 'none' | 'pending' | 'approved' | 'rejected' | 'needs_review';
	submittedAt: string | null;
	voteClosesAt: string | null;
	/** When they may request again after a rejection; null when they may now. */
	cooldownUntil: string | null;
}

/**
 * The caller's own reactivation status.
 *
 * Needed because `getMembershipVisibility` deliberately hides a member's own
 * membership vote from them — they cannot watch or campaign on it through
 * `/api/proposals`. This endpoint tells them only what they are entitled to
 * know: that a request exists, and how it ended.
 */
export async function getReactivationStatus(
	userId: string,
	email: string,
	now: Date = new Date()
): Promise<ReactivationStatus> {
	const [latest] = await db
		.select()
		.from(applications)
		.where(and(eq(applications.type, 'reactivation'), eq(applications.email, email)))
		.orderBy(desc(applications.submittedAt))
		.limit(1);

	if (!latest) {
		return {
			requestId: null,
			proposalId: null,
			state: 'none',
			submittedAt: null,
			voteClosesAt: null,
			cooldownUntil: null
		};
	}

	const [proposal] = await db
		.select()
		.from(proposals)
		.where(eq(proposals.linkedApplicationId, latest.id))
		.limit(1);

	let state: ReactivationStatus['state'] = 'pending';
	if (proposal?.status === 'closed' || proposal?.status === 'ratified') {
		state =
			proposal.result === 'approved'
				? 'approved'
				: proposal.result === 'needs_review'
					? 'needs_review'
					: 'rejected';
	}

	// A rejection starts a cooldown, so a refused request cannot be resubmitted
	// immediately and turned into a standing claim on the community's attention.
	let cooldownUntil: string | null = null;
	if (state === 'rejected' && proposal?.voteClosesAt) {
		const until = new Date(
			proposal.voteClosesAt.getTime() + POLICY.reactivation.cooldownDays * DAY_MS
		);
		if (until > now) cooldownUntil = until.toISOString();
	}

	return {
		requestId: latest.id,
		proposalId: proposal?.id ?? null,
		state,
		submittedAt: latest.submittedAt,
		voteClosesAt: proposal?.voteClosesAt?.toISOString() ?? null,
		cooldownUntil
	};
}

/**
 * Open a reactivation request.
 *
 * Refuses when a request is already open or the cooldown from a rejection has
 * not elapsed. The vote itself is a normal operational proposal, so it appears
 * in the Voting app for every active member — except its author, who is
 * excluded by the membership-visibility rules.
 */
export async function requestReactivation(
	userId: string,
	reason: string,
	now: Date = new Date()
): Promise<{ ok: boolean; error?: string; proposalId?: string }> {
	const member = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
	if (!member) return { ok: false, error: 'User not found' };
	if (member.membershipStatus !== 'standby') {
		return { ok: false, error: 'Only a member on standby can request reactivation' };
	}

	const trimmed = reason.trim();
	if (trimmed.length < 10) {
		return { ok: false, error: 'Please give a reason of at least 10 characters' };
	}

	const status = await getReactivationStatus(userId, member.email, now);
	if (status.state === 'pending') {
		return { ok: false, error: 'You already have a reactivation request being voted on' };
	}
	if (status.cooldownUntil) {
		return {
			ok: false,
			error: `You can request reactivation again after ${new Date(status.cooldownUntil).toLocaleDateString()}`
		};
	}

	const displayName = member.displayName?.trim() || member.name;

	const [application] = await db
		.insert(applications)
		.values({
			type: 'reactivation',
			fullName: displayName,
			email: member.email,
			formData: JSON.stringify({ reason: trimmed, userId }),
			status: 'proposal_created'
		})
		.returning();

	const proposal = await createSystemProposal({
		type: POLICY.reactivation.proposalType,
		choiceSetKey: 'membership',
		tags: ['membership', 'reactivation'],
		title: `Reactivate ${displayName}'s membership`,
		body: [
			`${displayName} is on standby and has asked to reactivate their membership.`,
			'',
			'**Their reason:**',
			'',
			trimmed
		].join('\n'),
		linkedApplicationId: application.id
	});

	apiLogger.info({ userId, proposalId: proposal.id }, 'Reactivation requested');
	return { ok: true, proposalId: proposal.id };
}
