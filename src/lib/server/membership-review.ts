/**
 * Membership transition evaluator.
 *
 * Turns the plan's inactivity timers into *proposals* a steward decides on.
 * Nothing here ever changes a membership: downgrades are proposed, reviewed by
 * a human, and applied by an explicit action. That is the one rule the whole
 * phase is built around — a timer must never be able to quietly remove
 * someone's access.
 *
 * The decision itself ({@link evaluateMembership}) is pure, so every edge is
 * testable without a database.
 */

import { POLICY, type MembershipStatus, type Role } from '$lib/policy';

const DAY_MS = 86_400_000;

/** The transitions a timer can propose. Promotions are never proposed here. */
export type ReviewKind = 'trial_to_standby' | 'member_to_exited' | 'standby_to_exited';

export interface MembershipSnapshot {
	userId: string;
	role: Role;
	status: MembershipStatus;
	/** Null when no participation has ever been recorded. See below — this matters. */
	lastParticipationAt: Date | null;
	/** When the member entered their current status. Drives the standby clock. */
	membershipStatusSince: Date | null;
}

export interface ProposedTransition {
	userId: string;
	kind: ReviewKind;
	fromStatus: MembershipStatus;
	toStatus: MembershipStatus;
	/** Days of the relevant clock that have elapsed — the evidence for the proposal. */
	daysElapsed: number;
	/** Threshold that was crossed, so the review shows the rule as well as the fact. */
	thresholdDays: number;
	/** Member-facing summary, reused in the warning email and the review queue. */
	reason: string;
}

/**
 * Decide whether a member's timers have elapsed.
 *
 * Returns null when there is nothing to propose — which is the common case and
 * deliberately includes several situations that might look like inactivity:
 *
 * - **No participation ever recorded.** Absence of a signal is not evidence of
 *   absence. Participation tracking started partway through the community's
 *   life, so every existing member began with `lastParticipationAt = null`;
 *   treating that as "inactive since forever" would propose exiting everyone on
 *   the first run. The evaluator stays silent until it has a real timestamp,
 *   and starts working per-member as each one acts.
 * - **Already exited.** Terminal.
 * - **A timer disabled in POLICY** (null threshold).
 */
export function evaluateMembership(
	member: MembershipSnapshot,
	now: Date = new Date()
): ProposedTransition | null {
	if (member.status === 'exited') return null;

	if (member.status === 'standby') {
		// The standby clock measures time *in standby*, not inactivity — a standby
		// member is not expected to participate, so counting their silence against
		// them would be incoherent.
		return evaluateElapsed(
			member,
			'standby_to_exited',
			'exited',
			member.membershipStatusSince,
			POLICY.timers.standbyToExited,
			now,
			(days) => `On standby for ${days} days`
		);
	}

	// Active from here. Both remaining timers measure inactivity, so without a
	// participation timestamp there is nothing to measure.
	if (!member.lastParticipationAt) return null;

	if (member.role === 'trial') {
		return evaluateElapsed(
			member,
			'trial_to_standby',
			'standby',
			member.lastParticipationAt,
			POLICY.timers.trialToStandby,
			now,
			(days) => `No participation for ${days} days as a trial member`
		);
	}

	return evaluateElapsed(
		member,
		'member_to_exited',
		'exited',
		member.lastParticipationAt,
		POLICY.timers.memberToExited,
		now,
		(days) => `No participation for ${days} days`
	);
}

function evaluateElapsed(
	member: MembershipSnapshot,
	kind: ReviewKind,
	toStatus: MembershipStatus,
	since: Date | null,
	thresholdDays: number | null,
	now: Date,
	describe: (days: number) => string
): ProposedTransition | null {
	if (!since || !thresholdDays) return null;

	const daysElapsed = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
	if (daysElapsed < thresholdDays) return null;

	return {
		userId: member.userId,
		kind,
		fromStatus: member.status,
		toStatus,
		daysElapsed,
		thresholdDays,
		reason: describe(daysElapsed)
	};
}

/**
 * Days until a member's timer elapses, or null when no timer applies.
 *
 * Drives the advance warnings in `POLICY.timers.warnBeforeDays`: a member
 * should hear that their membership is about to change *before* it lands in
 * anyone's review queue. Negative once the threshold has passed.
 */
export function daysUntilTransition(
	member: MembershipSnapshot,
	now: Date = new Date()
): number | null {
	if (member.status === 'exited') return null;

	const [since, threshold] =
		member.status === 'standby'
			? [member.membershipStatusSince, POLICY.timers.standbyToExited]
			: [
					member.lastParticipationAt,
					member.role === 'trial' ? POLICY.timers.trialToStandby : POLICY.timers.memberToExited
				];

	if (!since || !threshold) return null;

	const daysElapsed = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
	return threshold - daysElapsed;
}

/**
 * Advance-warning marks that have been reached but not yet passed.
 *
 * Returns every mark where the remaining days have fallen to or below it,
 * **most urgent first**, and an empty array once the threshold itself has
 * elapsed — by then it is a proposal in the review queue, not a warning.
 *
 * This is deliberately "at or below" rather than an exact-day match. Evaluation
 * is lazy-on-read: nothing guarantees the app is touched on precisely day T-14,
 * and an exact match would silently drop the warning for that whole cycle. A
 * member must not lose their notice because the community happened to be quiet
 * that day.
 *
 * The caller sends only the most urgent mark and records the rest as
 * superseded — see `sendDueWarnings`. Firing every reached mark at once would
 * mean two emails in the same minute.
 */
export function dueWarningMarks(member: MembershipSnapshot, now: Date = new Date()): number[] {
	const remaining = daysUntilTransition(member, now);
	if (remaining === null || remaining <= 0) return [];

	return POLICY.timers.warnBeforeDays
		.filter((mark) => remaining <= mark)
		.slice()
		.sort((a, b) => a - b);
}

/**
 * The anchor identifying the current countdown cycle.
 *
 * Warnings are recorded against this, so a member who goes quiet, is warned,
 * participates again, and later goes quiet once more gets a fresh set of
 * warnings — their new activity moves the anchor, which makes it a new cycle.
 */
export function cycleAnchor(member: MembershipSnapshot): Date | null {
	return member.status === 'standby' ? member.membershipStatusSince : member.lastParticipationAt;
}
