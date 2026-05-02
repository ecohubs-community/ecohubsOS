import { describe, it, expect } from 'vitest';
import { computePeriods, isValidProposalType, TYPE_CONFIG } from './periods';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-01T12:00:00Z');

describe('computePeriods', () => {
	it('Operational: vote opens immediately, closes after 3 days, no ratification', () => {
		const p = computePeriods('operational', NOW);
		expect(p.voteOpensAt.getTime()).toBe(NOW.getTime());
		expect(p.voteClosesAt.getTime() - p.voteOpensAt.getTime()).toBe(3 * DAY);
		expect(p.ratificationEndsAt).toBeNull();
	});

	it('Strategic: 5-day deliberation, 7-day vote, no ratification', () => {
		const p = computePeriods('strategic', NOW);
		expect(p.voteOpensAt.getTime() - NOW.getTime()).toBe(5 * DAY);
		expect(p.voteClosesAt.getTime() - p.voteOpensAt.getTime()).toBe(7 * DAY);
		expect(p.ratificationEndsAt).toBeNull();
	});

	it('Constitutional: 15-day deliberation, 14-day vote, 30-day ratification', () => {
		const p = computePeriods('constitutional', NOW);
		expect(p.voteOpensAt.getTime() - NOW.getTime()).toBe(15 * DAY);
		expect(p.voteClosesAt.getTime() - p.voteOpensAt.getTime()).toBe(14 * DAY);
		expect(p.ratificationEndsAt).not.toBeNull();
		expect(p.ratificationEndsAt!.getTime() - p.voteClosesAt.getTime()).toBe(30 * DAY);
	});

	it('TYPE_CONFIG threshold matches type', () => {
		expect(TYPE_CONFIG.operational.threshold).toBe('majority');
		expect(TYPE_CONFIG.strategic.threshold).toBe('majority');
		expect(TYPE_CONFIG.constitutional.threshold).toBe('supermajority');
	});
});

describe('isValidProposalType', () => {
	it('accepts the three known types', () => {
		expect(isValidProposalType('operational')).toBe(true);
		expect(isValidProposalType('strategic')).toBe(true);
		expect(isValidProposalType('constitutional')).toBe(true);
	});

	it('rejects unknown types', () => {
		expect(isValidProposalType('organizational')).toBe(false);
		expect(isValidProposalType('OPERATIONAL')).toBe(false);
		expect(isValidProposalType('')).toBe(false);
	});
});
