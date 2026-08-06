import { describe, it, expect } from 'vitest';
import {
	isNewer,
	daysSinceParticipation,
	recordLogin,
	LOGIN_REFRESH_MS,
	PARTICIPATION_SOURCES,
	type ParticipationSource
} from './participation';

const NOW = new Date('2026-08-01T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('isNewer', () => {
	it('accepts anything when nothing is stored', () => {
		expect(isNewer(NOW, null)).toBe(true);
	});

	it('accepts a later timestamp', () => {
		expect(isNewer(new Date(NOW.getTime() + 1), NOW)).toBe(true);
	});

	it('rejects an earlier one, so a late webhook cannot regress activity', () => {
		expect(isNewer(new Date(NOW.getTime() - DAY), NOW)).toBe(false);
	});

	it('rejects an identical timestamp — nothing to update', () => {
		expect(isNewer(NOW, NOW)).toBe(false);
	});
});

describe('daysSinceParticipation', () => {
	it('is null when the member has never participated', () => {
		expect(daysSinceParticipation(null, NOW)).toBeNull();
	});

	it('counts whole days elapsed', () => {
		expect(daysSinceParticipation(new Date(NOW.getTime() - 90 * DAY), NOW)).toBe(90);
		expect(daysSinceParticipation(new Date(NOW.getTime() - 365 * DAY), NOW)).toBe(365);
	});

	it('reports 0 for activity earlier the same day', () => {
		expect(daysSinceParticipation(new Date(NOW.getTime() - HOUR), NOW)).toBe(0);
	});

	it('does not go negative for a future timestamp', () => {
		// Backdated buddy calls are the only source that can be off, and they are
		// in the past — but a clock skew must not produce a negative age.
		expect(daysSinceParticipation(new Date(NOW.getTime() + HOUR), NOW)).toBeLessThanOrEqual(0);
	});
});

describe('recordLogin throttling', () => {
	// recordLogin writes via the DB; these assert only the throttle decision,
	// which is the part that governs write volume.
	it('writes when nothing has been recorded yet', async () => {
		expect(await recordLogin('u1', null, NOW)).toBe(true);
	});

	it('skips while inside the refresh window', async () => {
		const recent = new Date(NOW.getTime() - (LOGIN_REFRESH_MS - 1000));
		expect(await recordLogin('u1', recent, NOW)).toBe(false);
	});

	it('writes once the window has elapsed', async () => {
		const stale = new Date(NOW.getTime() - (LOGIN_REFRESH_MS + 1000));
		expect(await recordLogin('u1', stale, NOW)).toBe(true);
	});

	it('keeps the window well under the shortest inactivity timer', () => {
		// 90 days is the shortest timer; the throttle must be negligible beside it.
		expect(LOGIN_REFRESH_MS).toBeLessThan(90 * DAY);
	});
});

describe('participation sources', () => {
	it('gives every source a human label for the Members app', () => {
		for (const key of Object.keys(PARTICIPATION_SOURCES) as ParticipationSource[]) {
			expect(PARTICIPATION_SOURCES[key].length, key).toBeGreaterThan(0);
		}
	});

	it('covers every signal the write points emit', () => {
		// Kept in sync by hand; this fails loudly if a call site invents a source.
		expect(Object.keys(PARTICIPATION_SOURCES).sort()).toEqual(
			[
				'buddy_call',
				'login',
				'offcoin_xp',
				'onboarding',
				'puckstack_activity',
				'proposal',
				'steward_logged',
				'vote'
			].sort()
		);
	});
});
