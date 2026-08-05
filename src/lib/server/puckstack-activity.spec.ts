import { describe, it, expect } from 'vitest';
import { SYNC_INTERVAL_MS } from './puckstack-activity';
import { POLICY } from '$lib/policy';

const DAY_MS = 86_400_000;

/**
 * `syncPuckstackActivity` is database- and network-bound; these cover the
 * pacing decisions, which are the part that could quietly go wrong — too eager
 * and every steward page load fans out HTTP calls, too lazy and a member is
 * proposed for exit on stale evidence.
 */
describe('sync pacing', () => {
	it('re-asks at most daily', () => {
		expect(SYNC_INTERVAL_MS).toBe(DAY_MS);
	});

	it('is negligible against the timers it feeds', () => {
		// A day's lag cannot matter to a threshold measured in months.
		expect(SYNC_INTERVAL_MS).toBeLessThan((POLICY.timers.trialToStandby * DAY_MS) / 10);
	});

	it('leaves room to refresh well before the shortest timer elapses', () => {
		// The staleness gate is half the shortest timer, so a member drifting
		// toward standby gets many syncs before anything is proposed.
		const staleAfterDays = Math.floor(POLICY.timers.trialToStandby / 2);
		const syncsBeforeThreshold =
			((POLICY.timers.trialToStandby - staleAfterDays) * DAY_MS) / SYNC_INTERVAL_MS;
		expect(syncsBeforeThreshold).toBeGreaterThan(30);
	});
});
