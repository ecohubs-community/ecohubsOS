/**
 * Offcoin XP → level arithmetic.
 *
 * Offcoin awards a level every time XP crosses `100 × level²`, so the bands are
 * 0–100, 100–400, 400–900, 900–1600 … Each band is wider than the last, which is
 * exactly why progress has to be measured *inside* the band: a member on 1028 XP
 * is 18% of the way to level 4, not 64%, and not 100%.
 *
 * Offcoin remains the source of truth for the level itself — `levelProgress`
 * takes it as an argument so the bar can never disagree with the number printed
 * next to it. The formula here only places a member within their band.
 */

/** XP at which `level` begins. Level 0 starts at 0. */
export function xpForLevel(level: number): number {
	if (!Number.isFinite(level) || level <= 0) return 0;
	return 100 * Math.floor(level) ** 2;
}

/** The level `xp` earns, by Offcoin's own thresholds. */
export function getLevel(xp: number): number {
	if (!Number.isFinite(xp) || xp <= 0) return 0;
	return Math.floor(Math.sqrt(xp) / 10);
}

export interface LevelProgress {
	level: number;
	/** XP at which the current level began. */
	levelStartXp: number;
	/** XP at which the next level begins. */
	nextLevelXp: number;
	/** Width of the current band — the denominator a member should see. */
	levelSpan: number;
	/** How far into the band they are, clamped to the band. */
	xpIntoLevel: number;
	/** What is left of the band. */
	xpToNextLevel: number;
	/** 0–100, rounded. Safe to use directly as a bar width. */
	percent: number;
}

/**
 * Where a member sits within their current level.
 *
 * Pass Offcoin's `level` when you have it. It is only used to pick the band; if
 * it ever disagrees with `xp` the position is clamped into that band rather than
 * allowed to run negative or past the end, so a mismatch shows as a full or
 * empty bar under the level Offcoin actually reports — never as a broken one.
 */
export function levelProgress(xp: number, level?: number): LevelProgress {
	const safeXp = Number.isFinite(xp) && xp > 0 ? xp : 0;
	const resolvedLevel =
		level !== undefined && Number.isFinite(level) && level >= 0
			? Math.floor(level)
			: getLevel(safeXp);

	const levelStartXp = xpForLevel(resolvedLevel);
	const nextLevelXp = xpForLevel(resolvedLevel + 1);
	const levelSpan = nextLevelXp - levelStartXp;

	const xpIntoLevel = Math.min(Math.max(safeXp - levelStartXp, 0), levelSpan);
	const xpToNextLevel = levelSpan - xpIntoLevel;

	return {
		level: resolvedLevel,
		levelStartXp,
		nextLevelXp,
		levelSpan,
		xpIntoLevel,
		xpToNextLevel,
		percent: levelSpan > 0 ? Math.round((xpIntoLevel / levelSpan) * 100) : 0
	};
}
