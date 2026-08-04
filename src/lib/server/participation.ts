/**
 * Participation tracking.
 *
 * The membership plan's exit conditions are timers — "3 months without
 * participation", "12 months inactivity" — so something has to record when a
 * member last took part. This module is that something.
 *
 * It is deliberately write-only and side-effect-free beyond a single column
 * update: recording participation must never be able to fail a member's actual
 * action. Every call site treats it as fire-and-forget.
 */

import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { apiLogger } from '$lib/server/logger';

/**
 * What counted as participation. Ordered roughly weakest → strongest signal;
 * the label is what a steward sees in the Members app.
 */
export const PARTICIPATION_SOURCES = {
	login: 'Logged in',
	onboarding: 'Onboarding step',
	offcoin_xp: 'Earned XP',
	vote: 'Voted',
	proposal: 'Authored a proposal',
	buddy_call: 'Buddy call',
	/**
	 * Manual entry for activity the OS cannot see — a meeting attended, work done
	 * outside Puckstack. Declared now because the timers must be able to be
	 * overridden by a human; the steward-facing control for it lands with the
	 * review queue in the next phase, so nothing writes this yet.
	 */
	steward_logged: 'Logged by a steward'
} as const;

export type ParticipationSource = keyof typeof PARTICIPATION_SOURCES;

/**
 * A login alone is the weakest possible signal, and it fires on every request.
 * Only refresh it when the stored timestamp is at least this old, so a browsing
 * session costs one write rather than hundreds.
 *
 * This is a write-throttle, not a policy: it can make `lastParticipationAt`
 * lag by up to this much, which is irrelevant against timers measured in
 * months.
 */
export const LOGIN_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Record that a member took part.
 *
 * Moves the timestamp forward only. An out-of-order call — a webhook arriving
 * late, a backfill replaying old events — must not make someone look less
 * active than they are.
 *
 * Never throws: a failure here would otherwise turn a successful vote into a
 * 500. Failures are logged and swallowed.
 */
export async function recordParticipation(
	userId: string,
	source: ParticipationSource,
	at: Date = new Date()
): Promise<void> {
	try {
		// Forward-only, enforced in the WHERE clause so it holds even against a
		// concurrent write: a late-arriving webhook cannot drag the timestamp
		// backwards and make someone look less active than they are.
		await db
			.update(userTable)
			.set({ lastParticipationAt: at, lastParticipationSource: source, updatedAt: new Date() })
			.where(
				and(
					eq(userTable.id, userId),
					or(isNull(userTable.lastParticipationAt), lt(userTable.lastParticipationAt, at))
				)
			);
	} catch (err) {
		apiLogger.error({ err, userId, source }, 'Failed to record participation');
	}
}

/**
 * Login-specific variant, throttled by {@link LOGIN_REFRESH_MS}.
 *
 * Takes the already-loaded timestamp so the hot path costs no extra read —
 * `hooks.server.ts` has the user row in hand on every authenticated request.
 *
 * Returns true when a write was issued, which is what the tests assert on.
 */
export async function recordLogin(
	userId: string,
	lastParticipationAt: Date | null,
	now: Date = new Date()
): Promise<boolean> {
	if (lastParticipationAt && now.getTime() - lastParticipationAt.getTime() < LOGIN_REFRESH_MS) {
		return false;
	}
	await recordParticipation(userId, 'login', now);
	return true;
}

/**
 * Whether a recorded participation should replace what is stored.
 *
 * Exported for the tests and for any caller that has the previous value to
 * hand; `recordParticipation` itself writes unconditionally, because its call
 * sites are all "this just happened".
 */
export function isNewer(candidate: Date, stored: Date | null): boolean {
	return !stored || candidate.getTime() > stored.getTime();
}

/** Days since a member last took part, or null if they never have. */
export function daysSinceParticipation(
	lastParticipationAt: Date | null,
	now: Date = new Date()
): number | null {
	if (!lastParticipationAt) return null;
	return Math.floor((now.getTime() - lastParticipationAt.getTime()) / 86_400_000);
}
