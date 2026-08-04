import { describe, it, expect } from 'vitest';
import {
	evaluateMembership,
	daysUntilTransition,
	warningDue,
	type MembershipSnapshot
} from './membership-review';
import { POLICY } from '$lib/policy';

const NOW = new Date('2026-08-01T12:00:00Z');
const DAY = 86_400_000;

function daysAgo(n: number): Date {
	return new Date(NOW.getTime() - n * DAY);
}

function snapshot(over: Partial<MembershipSnapshot> = {}): MembershipSnapshot {
	return {
		userId: 'u1',
		role: 'member',
		status: 'active',
		lastParticipationAt: daysAgo(1),
		membershipStatusSince: daysAgo(1),
		...over
	};
}

describe('no participation recorded', () => {
	// The single most important guard in this phase. Participation tracking
	// started partway through the community's life, so every existing member
	// begins with null. Treating that as "inactive since forever" would propose
	// exiting the entire community on the first run.
	it('proposes nothing for an active member who has never participated', () => {
		expect(evaluateMembership(snapshot({ lastParticipationAt: null }), NOW)).toBeNull();
	});

	it('proposes nothing for a trial member who has never participated', () => {
		expect(
			evaluateMembership(snapshot({ role: 'trial', lastParticipationAt: null }), NOW)
		).toBeNull();
	});

	it('stays silent even for an account created years ago', () => {
		const ancient = snapshot({
			lastParticipationAt: null,
			membershipStatusSince: daysAgo(3000)
		});
		expect(evaluateMembership(ancient, NOW)).toBeNull();
	});

	it('reports no countdown, rather than an elapsed one', () => {
		expect(daysUntilTransition(snapshot({ lastParticipationAt: null }), NOW)).toBeNull();
		expect(warningDue(snapshot({ lastParticipationAt: null }), NOW)).toBeNull();
	});

	it('starts working for a member as soon as they act', () => {
		const acted = snapshot({
			role: 'trial',
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby + 1)
		});
		expect(evaluateMembership(acted, NOW)).not.toBeNull();
	});
});

describe('trial → standby', () => {
	const threshold = POLICY.timers.trialToStandby;

	it('proposes standby once the trial member has been idle past the threshold', () => {
		const result = evaluateMembership(
			snapshot({ role: 'trial', lastParticipationAt: daysAgo(threshold) }),
			NOW
		);
		expect(result).toMatchObject({
			kind: 'trial_to_standby',
			fromStatus: 'active',
			toStatus: 'standby',
			thresholdDays: threshold
		});
	});

	it('proposes nothing the day before', () => {
		expect(
			evaluateMembership(
				snapshot({ role: 'trial', lastParticipationAt: daysAgo(threshold - 1) }),
				NOW
			)
		).toBeNull();
	});

	it('explains itself in the reason', () => {
		const result = evaluateMembership(
			snapshot({ role: 'trial', lastParticipationAt: daysAgo(threshold) }),
			NOW
		);
		expect(result?.reason).toContain('trial member');
		expect(result?.reason).toContain(String(threshold));
	});
});

describe('member → exited', () => {
	const threshold = POLICY.timers.memberToExited;

	it('proposes exit only after the longer member threshold', () => {
		expect(
			evaluateMembership(snapshot({ lastParticipationAt: daysAgo(threshold - 1) }), NOW)
		).toBeNull();
		expect(
			evaluateMembership(snapshot({ lastParticipationAt: daysAgo(threshold) }), NOW)
		).toMatchObject({ kind: 'member_to_exited', toStatus: 'exited' });
	});

	it('does not apply the short trial timer to a full member', () => {
		// A member idle for 90 days is not close to exiting; only trials are.
		expect(
			evaluateMembership(
				snapshot({ lastParticipationAt: daysAgo(POLICY.timers.trialToStandby) }),
				NOW
			)
		).toBeNull();
	});

	it('treats stewards and admins by the same clock as members', () => {
		for (const role of ['steward', 'admin'] as const) {
			expect(
				evaluateMembership(snapshot({ role, lastParticipationAt: daysAgo(threshold) }), NOW)
			).toMatchObject({ kind: 'member_to_exited' });
		}
	});
});

describe('standby → exited', () => {
	const threshold = POLICY.timers.standbyToExited;

	it('measures time in standby, not inactivity', () => {
		// A standby member is not expected to participate, so their silence must
		// not count against them — only the length of the pause does.
		const longPausedButIdle = snapshot({
			status: 'standby',
			membershipStatusSince: daysAgo(threshold),
			lastParticipationAt: daysAgo(9999)
		});
		expect(evaluateMembership(longPausedButIdle, NOW)).toMatchObject({
			kind: 'standby_to_exited',
			fromStatus: 'standby',
			toStatus: 'exited'
		});

		const recentlyPaused = snapshot({
			status: 'standby',
			membershipStatusSince: daysAgo(threshold - 1),
			lastParticipationAt: daysAgo(9999)
		});
		expect(evaluateMembership(recentlyPaused, NOW)).toBeNull();
	});

	it('proposes nothing when the standby start date is unknown', () => {
		expect(
			evaluateMembership(snapshot({ status: 'standby', membershipStatusSince: null }), NOW)
		).toBeNull();
	});
});

describe('exited members are terminal', () => {
	it('never proposes anything, however stale', () => {
		expect(
			evaluateMembership(snapshot({ status: 'exited', lastParticipationAt: daysAgo(9999) }), NOW)
		).toBeNull();
	});

	it('has no countdown', () => {
		expect(daysUntilTransition(snapshot({ status: 'exited' }), NOW)).toBeNull();
	});
});

describe('advance warnings', () => {
	it('fires at each configured mark before the threshold', () => {
		for (const mark of POLICY.timers.warnBeforeDays) {
			const member = snapshot({
				role: 'trial',
				lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - mark)
			});
			expect(warningDue(member, NOW), `mark ${mark}`).toBe(mark);
		}
	});

	it('is silent between the marks', () => {
		const between = snapshot({
			role: 'trial',
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 30)
		});
		expect(warningDue(between, NOW)).toBeNull();
	});

	it('is silent once the threshold has passed — by then it is a proposal', () => {
		const overdue = snapshot({
			role: 'trial',
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby + 5)
		});
		expect(warningDue(overdue, NOW)).toBeNull();
		expect(evaluateMembership(overdue, NOW)).not.toBeNull();
	});

	it('counts down toward the threshold', () => {
		const member = snapshot({ role: 'trial', lastParticipationAt: daysAgo(80) });
		expect(daysUntilTransition(member, NOW)).toBe(POLICY.timers.trialToStandby - 80);
	});
});

describe('the evaluator never promotes or applies', () => {
	it('only ever proposes standby or exited', () => {
		const cases: MembershipSnapshot[] = [
			snapshot({ role: 'trial', lastParticipationAt: daysAgo(9999) }),
			snapshot({ role: 'member', lastParticipationAt: daysAgo(9999) }),
			snapshot({ status: 'standby', membershipStatusSince: daysAgo(9999) })
		];
		for (const c of cases) {
			const result = evaluateMembership(c, NOW);
			expect(['standby', 'exited']).toContain(result?.toStatus);
		}
	});

	it('proposes nothing for a member who participated today', () => {
		expect(evaluateMembership(snapshot({ lastParticipationAt: NOW }), NOW)).toBeNull();
	});
});
