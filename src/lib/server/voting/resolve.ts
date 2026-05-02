import type { Threshold } from './periods';

export type VoteResult = 'approved' | 'rejected' | 'needs_review' | 'tied';

export type Tallies = Record<string, number>;

/**
 * Resolve the outcome of a 3-choice ballot per voting-system.md §3.4.
 *
 * - Choice[0] is the affirmative ("For" / "Approve" / "Publish").
 * - Threshold applies to Choice[0]'s share of all votes cast.
 * - If Choice[0] meets the threshold → approved.
 * - Otherwise: runner-up between Choice[1] and Choice[2] (raw count) decides:
 *     Choice[1] wins → rejected
 *     Choice[2] wins → needs_review
 *     Choice[1] === Choice[2] → tied (status quo holds)
 * - Zero votes cast → rejected (no mandate; status quo holds).
 *
 * The resolver is permissive about extra keys in `tallies` (ignored) and
 * choice arrays of length other than 3 (only the first three are inspected,
 * with missing slots treated as 0).
 */
export function resolveResult(
	tallies: Tallies,
	choices: readonly string[],
	threshold: Threshold
): VoteResult {
	const c0 = choices[0];
	const c1 = choices[1];
	const c2 = choices[2];

	const v0 = c0 ? (tallies[c0] ?? 0) : 0;
	const v1 = c1 ? (tallies[c1] ?? 0) : 0;
	const v2 = c2 ? (tallies[c2] ?? 0) : 0;
	const total = v0 + v1 + v2;

	if (total === 0) return 'rejected';

	const share = v0 / total;
	const meetsThreshold = threshold === 'supermajority' ? share >= 2 / 3 : share > 0.5;
	if (meetsThreshold) return 'approved';

	if (v1 > v2) return 'rejected';
	if (v2 > v1) return 'needs_review';
	return 'tied';
}
