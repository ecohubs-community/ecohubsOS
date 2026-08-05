import { describe, it, expect } from 'vitest';
import { xpFromEco, maxEcoPerGrant } from './rewards';
import { POLICY } from '$lib/policy';

describe('xpFromEco', () => {
	it('applies the same 1.5x rate Puckstack uses for tasks', () => {
		// The point of sharing the ratio: the same contribution is worth the same
		// whether it is recognised via a task or by a steward.
		expect(POLICY.grants.ecoToXpRatio).toBe(1.5);
		expect(xpFromEco(100)).toBe(150);
		expect(xpFromEco(10)).toBe(15);
	});

	it('rounds half up, matching what Puckstack awards', () => {
		expect(xpFromEco(5)).toBe(8);
		expect(xpFromEco(1)).toBe(2);
		expect(xpFromEco(3)).toBe(5);
	});

	it('never returns negative XP — Offcoin rejects non-positive amounts', () => {
		expect(xpFromEco(-50)).toBe(0);
		expect(xpFromEco(0)).toBe(0);
	});
});

describe('per-grant ceiling', () => {
	it('is bounded by the XP cap, not just the ECO cap', () => {
		// XP is the privilege-escalation path, so its cap has to bind even when
		// the steward is thinking in ECO. 100 XP / 1.5 = 66 ECO.
		expect(maxEcoPerGrant()).toBe(66);
		expect(xpFromEco(maxEcoPerGrant())).toBeLessThanOrEqual(POLICY.grants.maxXpPerGrant);
	});

	it('one more ECO would breach the XP cap', () => {
		expect(xpFromEco(maxEcoPerGrant() + 1)).toBeGreaterThan(POLICY.grants.maxXpPerGrant);
	});

	it('lets a steward make several grants a day, not just one', () => {
		// A daily cap that only allowed a single grant would push stewards toward
		// hoarding recognition for whoever asked first.
		expect(POLICY.grants.maxXpPerActorPerDay).toBeGreaterThan(POLICY.grants.maxXpPerGrant);
	});
});

describe('guardrails', () => {
	it('blocks self-grants and negative grants', () => {
		expect(POLICY.grants.allowSelfGrant).toBe(false);
		expect(POLICY.grants.allowNegative).toBe(false);
	});
});
