/**
 * Folding Puckstack task activity into participation.
 *
 * The Offcoin webhook already tells us when someone *earns* XP, but plenty of
 * real work does not end in a reward — picking up a task, commenting, being
 * assigned something. Puckstack's `/contributions/activity` reports when a
 * member last did any of it, and this folds that into `lastParticipationAt`.
 *
 * Runs lazily on read, before the review evaluator. That ordering is the point:
 * proposing to exit someone whose Puckstack activity we had not checked would
 * be exactly the wrong mistake.
 */

import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { POLICY, type MembershipStatus } from '$lib/policy';
import { recordParticipation } from '$lib/server/participation';
import { puckstackLogger } from '$lib/server/logger';

const DAY_MS = 86_400_000;

/**
 * How stale a member's Puckstack sync may be before we ask again.
 *
 * Generous on purpose. The timers this feeds are measured in months, so a day's
 * lag is irrelevant — and the alternative is one HTTP call per member every
 * time a steward opens the review queue.
 */
export const SYNC_INTERVAL_MS = DAY_MS;

/**
 * How many members one run will ask about.
 *
 * Each is a sequential HTTP round-trip inside a request handler, so an
 * uncapped run would make the review queue as slow as the community is large.
 * It bites hardest on the very first run, when nobody has a participation
 * timestamp yet and every member therefore looks worth asking about.
 *
 * The cap is safe because progress is durable: each attempt stamps
 * `puckstackActivitySyncedAt`, so the next run picks up where this one stopped
 * and the backlog drains over a few page loads rather than one long wait.
 */
export const MAX_SYNCS_PER_RUN = 10;

/**
 * Only members already drifting toward a threshold are worth asking about.
 *
 * Someone who voted this morning is plainly active; a Puckstack round-trip
 * would tell us nothing. Syncing at half the shortest timer means we always
 * have fresh data well before anything is proposed, while leaving the clearly
 * active majority untouched.
 */
const STALE_AFTER_DAYS = Math.floor(POLICY.timers.trialToStandby / 2);

interface ActivityResponse {
	success: boolean;
	isMember?: boolean;
	activity?: {
		lastActivityAt: string | null;
	};
}

/**
 * Ask Puckstack when a member was last active.
 *
 * Returns null when the answer is unknown — unconfigured, unreachable, not a
 * workspace member, or no recorded activity. The caller must treat null as "no
 * evidence" rather than "inactive": an outage must not be able to feed the
 * inactivity timers.
 */
export async function fetchLastActivity(email: string): Promise<Date | null> {
	const apiUrl = env.PUCKSTACK_API_URL;
	const apiKey = env.PUCKSTACK_API_KEY;
	if (!apiUrl || !apiKey) return null;

	try {
		const response = await fetch(`${apiUrl}/contributions/activity`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({ workspaceSlug: 'ecohubs', email })
		});

		if (!response.ok) {
			puckstackLogger.error({ status: response.status }, 'contributions/activity returned non-OK');
			return null;
		}

		const data = (await response.json()) as ActivityResponse;
		if (!data.success || !data.isMember || !data.activity?.lastActivityAt) return null;

		const at = new Date(data.activity.lastActivityAt);
		return Number.isNaN(at.getTime()) ? null : at;
	} catch (err) {
		puckstackLogger.error({ err }, 'contributions/activity request failed');
		return null;
	}
}

/**
 * Refresh Puckstack activity for members whose participation looks stale.
 *
 * Deliberately narrow: exited members, members synced recently, and members who
 * have clearly done something lately are all skipped. What remains is the small
 * set where the answer could change a decision — and even that is capped per
 * run, so no single request pays for the whole backlog.
 *
 * `recordParticipation` is forward-only, so an older Puckstack timestamp can
 * never drag someone's participation backwards.
 *
 * Returns how many members were refreshed.
 */
export async function syncPuckstackActivity(now: Date = new Date()): Promise<number> {
	if (!env.PUCKSTACK_API_URL || !env.PUCKSTACK_API_KEY) return 0;

	const users = await db.select().from(userTable);
	let synced = 0;

	for (const u of users) {
		if (synced >= MAX_SYNCS_PER_RUN) break;
		if ((u.membershipStatus as MembershipStatus) === 'exited') continue;
		if (!u.puckstackUserId) continue;

		// Asked recently enough.
		if (
			u.puckstackActivitySyncedAt &&
			now.getTime() - u.puckstackActivitySyncedAt.getTime() < SYNC_INTERVAL_MS
		) {
			continue;
		}

		// Demonstrably active here already — nothing Puckstack says could move a
		// timer that is nowhere near elapsing.
		if (
			u.lastParticipationAt &&
			now.getTime() - u.lastParticipationAt.getTime() < STALE_AFTER_DAYS * DAY_MS
		) {
			continue;
		}

		const lastActivityAt = await fetchLastActivity(u.email);

		// Record the attempt whether or not it found anything, so an unreachable
		// Puckstack does not mean re-asking about the same members on every load.
		await db
			.update(userTable)
			.set({ puckstackActivitySyncedAt: now })
			.where(eq(userTable.id, u.id));
		synced++;

		if (lastActivityAt) {
			await recordParticipation(u.id, 'puckstack_activity', lastActivityAt);
		}
	}

	if (synced > 0) {
		puckstackLogger.info(
			{ synced, capped: synced >= MAX_SYNCS_PER_RUN },
			'Puckstack activity synced'
		);
	}
	return synced;
}
