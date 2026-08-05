import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OPEN_CASE_STATUSES } from './membership-cases';
import { POLICY } from '$lib/policy';

/**
 * `openCase` / `applyCaseOutcome` are database-bound, so these cover the parts
 * that encode the governance decision rather than the plumbing: which statuses
 * count as unresolved, and that the ballot a case uses cannot remove someone on
 * an empty vote.
 */

describe('open case statuses', () => {
	it('treats voting and needs_review as unresolved', () => {
		expect([...OPEN_CASE_STATUSES]).toEqual(['voting', 'needs_review']);
	});

	it('does not treat any terminal outcome as open', () => {
		for (const terminal of ['exited', 'dismissed', 'withdrawn']) {
			expect(OPEN_CASE_STATUSES).not.toContain(terminal);
		}
	});

	it('keeps needs_review open, so an inconclusive vote is not a quiet acquittal', () => {
		// A case that nobody voted on must stay in front of a steward. Closing it
		// automatically would let a member be either removed or reinstated purely
		// because the community was quiet that week.
		expect(OPEN_CASE_STATUSES).toContain('needs_review');
	});
});

describe('the ballot a case uses', () => {
	it('is the 3-day operational vote, not a slower type', () => {
		// A suspension is live while this runs, so the vote must not drag: the
		// member is locked out either way until it resolves.
		expect(POLICY.reactivation.proposalType).toBe('operational');
	});

	it('never reads an empty ballot as agreement to remove someone', () => {
		expect(POLICY.reactivation.zeroVotesResult).toBe('needs_review');
	});
});

describe('a suspension always has a way out', () => {
	// Regression guard for the ordering bug: the case used to suspend the member
	// first and create the vote second. A failure in between left them suspended
	// with no proposal — and applyCaseOutcome keys on proposalId, so nothing
	// could ever release them.
	it('creates the vote before the suspension', () => {
		const source = readFileSync(new URL('./membership-cases.ts', import.meta.url), 'utf8');
		const voteAt = source.indexOf('createSystemProposal(');
		const suspendAt = source.indexOf("membershipStatus: 'standby'");
		expect(voteAt).toBeGreaterThan(-1);
		expect(suspendAt).toBeGreaterThan(-1);
		expect(voteAt).toBeLessThan(suspendAt);
	});

	it('withdraws the vote if the case cannot be opened after it', () => {
		const source = readFileSync(new URL('./membership-cases.ts', import.meta.url), 'utf8');
		expect(source).toContain("status: 'withdrawn'");
	});
});
