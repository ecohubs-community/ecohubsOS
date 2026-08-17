import { describe, it, expect } from 'vitest';
import { getLevel, xpForLevel, levelProgress } from './balances.utils';

describe('getLevel', () => {
	// Confirmed against live Offcoin readings: 1028 XP → level 3, 4903 XP → 7.
	it.each([
		[0, 0],
		[99, 0],
		[100, 1],
		[399, 1],
		[400, 2],
		[900, 3],
		[1028, 3],
		[1214, 3],
		[1599, 3],
		[1600, 4],
		[4903, 7]
	])('puts %i XP at level %i', (xp, level) => {
		expect(getLevel(xp)).toBe(level);
	});

	it('never returns a negative or NaN level', () => {
		expect(getLevel(-50)).toBe(0);
		expect(getLevel(NaN)).toBe(0);
	});
});

describe('xpForLevel', () => {
	it('is the inverse of getLevel at every band boundary', () => {
		for (let level = 0; level <= 12; level++) {
			const start = xpForLevel(level);
			expect(getLevel(start)).toBe(level);
			if (level > 0) expect(getLevel(start - 1)).toBe(level - 1);
		}
	});
});

describe('levelProgress', () => {
	it('measures progress inside the band, not against total XP', () => {
		// The bug this replaces: 1028 / xpForNextLevel(1028) = 1028/572 → clamped
		// to 100%, so a member 18% into level 3 saw a full bar.
		const p = levelProgress(1028, 3);
		expect(p.levelStartXp).toBe(900);
		expect(p.nextLevelXp).toBe(1600);
		expect(p.levelSpan).toBe(700);
		expect(p.xpIntoLevel).toBe(128);
		expect(p.xpToNextLevel).toBe(572);
		expect(p.percent).toBe(18);
	});

	it('reads 0% at the start of a band', () => {
		expect(levelProgress(900, 3).percent).toBe(0);
	});

	it('still owes XP one short of the next level, even though the bar rounds to full', () => {
		// 699/700 rounds to 100% and that is the honest thing to draw; the figure
		// beside the bar is what has to stay exact.
		const p = levelProgress(1599, 3);
		expect(p.xpToNextLevel).toBe(1);
		expect(p.xpIntoLevel).toBe(699);
	});

	it('spans the full range across a band rather than snapping to the ends', () => {
		const percents = [0, 175, 350, 525, 699].map((into) => levelProgress(900 + into, 3).percent);
		expect(percents).toEqual([0, 25, 50, 75, 100]);
		// The old formula produced 100% for every one of these but the first.
		expect(new Set(percents).size).toBe(5);
	});

	it('falls back to the derived level when Offcoin has not supplied one', () => {
		expect(levelProgress(1028).level).toBe(3);
		expect(levelProgress(1028).percent).toBe(18);
	});

	it('clamps rather than going negative when the level and XP disagree', () => {
		// Offcoin says level 5, the snapshot still holds level-3 XP.
		const behind = levelProgress(1028, 5);
		expect(behind.level).toBe(5);
		expect(behind.xpIntoLevel).toBe(0);
		expect(behind.percent).toBe(0);

		const ahead = levelProgress(9000, 3);
		expect(ahead.xpIntoLevel).toBe(ahead.levelSpan);
		expect(ahead.percent).toBe(100);
	});

	it('handles a brand-new member', () => {
		const p = levelProgress(0, 0);
		expect(p.levelSpan).toBe(100);
		expect(p.xpIntoLevel).toBe(0);
		expect(p.percent).toBe(0);
		expect(p.xpToNextLevel).toBe(100);
	});
});
