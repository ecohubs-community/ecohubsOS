import { describe, it, expect } from 'vitest';
import { resolveResult } from './resolve';

const DEFAULT_CHOICES = ['For', 'Against', 'Needs Review'];
const MEMBERSHIP_CHOICES = ['Approve', 'Reject', 'Needs Review'];

describe('resolveResult — majority threshold', () => {
	it('approves when first choice has >50% of votes cast', () => {
		expect(
			resolveResult({ For: 60, Against: 30, 'Needs Review': 10 }, DEFAULT_CHOICES, 'majority')
		).toBe('approved');
	});

	it('does not approve at exactly 50% (must be strictly greater than)', () => {
		expect(
			resolveResult({ For: 50, Against: 30, 'Needs Review': 20 }, DEFAULT_CHOICES, 'majority')
		).toBe('rejected');
	});

	it('rejects when Choice[1] beats Choice[2]', () => {
		expect(
			resolveResult({ For: 40, Against: 35, 'Needs Review': 25 }, DEFAULT_CHOICES, 'majority')
		).toBe('rejected');
	});

	it('returns needs_review when Choice[2] beats Choice[1]', () => {
		expect(
			resolveResult({ For: 30, Against: 30, 'Needs Review': 40 }, DEFAULT_CHOICES, 'majority')
		).toBe('needs_review');
	});

	it('returns tied when Choice[1] equals Choice[2] and neither beats Choice[0] sufficiently', () => {
		expect(
			resolveResult({ For: 30, Against: 35, 'Needs Review': 35 }, DEFAULT_CHOICES, 'majority')
		).toBe('tied');
	});

	it('returns rejected on zero votes (status quo holds)', () => {
		expect(resolveResult({}, DEFAULT_CHOICES, 'majority')).toBe('rejected');
	});
});

describe('resolveResult — supermajority threshold', () => {
	it('approves at exactly 2/3', () => {
		expect(
			resolveResult({ For: 2, Against: 1, 'Needs Review': 0 }, DEFAULT_CHOICES, 'supermajority')
		).toBe('approved');
	});

	it('approves above 2/3', () => {
		expect(
			resolveResult({ For: 80, Against: 10, 'Needs Review': 10 }, DEFAULT_CHOICES, 'supermajority')
		).toBe('approved');
	});

	it('does NOT approve at simple majority but below supermajority', () => {
		expect(
			resolveResult({ For: 60, Against: 40, 'Needs Review': 0 }, DEFAULT_CHOICES, 'supermajority')
		).toBe('rejected');
	});
});

describe('resolveResult — alternative choice sets', () => {
	it('handles membership choices (Approve/Reject/Needs Review)', () => {
		expect(
			resolveResult(
				{ Approve: 7, Reject: 2, 'Needs Review': 1 },
				MEMBERSHIP_CHOICES,
				'majority'
			)
		).toBe('approved');
	});

	it('membership: tied non-approval branches', () => {
		expect(
			resolveResult(
				{ Approve: 1, Reject: 4, 'Needs Review': 4 },
				MEMBERSHIP_CHOICES,
				'majority'
			)
		).toBe('tied');
	});
});

describe('resolveResult — input robustness', () => {
	it('ignores tally keys not in the choices array', () => {
		expect(
			resolveResult(
				{ For: 60, Against: 30, 'Needs Review': 10, Spam: 9999 },
				DEFAULT_CHOICES,
				'majority'
			)
		).toBe('approved');
	});

	it('treats missing tally entries as zero', () => {
		expect(resolveResult({ For: 5 }, DEFAULT_CHOICES, 'majority')).toBe('approved');
	});
});
