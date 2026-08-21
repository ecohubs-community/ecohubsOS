/**
 * One-time (idempotent) payout of the welcome video's reward to members who
 * watched it before rewards existed.
 *
 * Wayfinder rewards started at deploy. Every member who sat through the
 * introduction before that got nothing for it, while the next person to join
 * gets paid for the same ten minutes. This closes that gap using the signal we
 * already hold — `user.introWatchedAt`, set the moment they finished it.
 *
 * Only the welcome video is backfilled, because it is the only video anyone
 * could have watched before this table existed. The rest of the catalogue was
 * published alongside rewards.
 *
 * Safe to re-run. The payout itself is guarded by the reward claim on the watch
 * row (see $lib/server/wayfinder-rewards), so a second run finds every row
 * already claimed and pays nobody. That guard — not this function's bookkeeping
 * — is what makes running this twice harmless.
 *
 * Deliberately conservative:
 *
 * - Members with no `introWatchedAt` are untouched. They never finished it, and
 *   paying them would be inventing a watch.
 * - Members who have not connected Offcoin are skipped **without** claiming the
 *   reward, so it is still waiting for them when they link their account.
 * - The watch row is dated to `introWatchedAt`, not to now, so the backfill does
 *   not rewrite when people actually watched.
 */

import { db } from '$lib/server/db';
import { user as userTable, wayfinderWatches } from '$lib/server/db/schema';
import { isNotNull } from 'drizzle-orm';
import { WELCOME_VIDEO_ID, findWayfinderVideo } from '$lib/wayfinder/videos';
import { rewardVideoWatch } from '$lib/server/wayfinder-rewards';
import { xpFromEco } from '$lib/server/rewards';
import { apiLogger } from '$lib/server/logger';

export interface WayfinderBackfillResult {
	/** Members with `introWatchedAt` set — the population considered. */
	total: number;
	/** Paid by this run. */
	rewarded: number;
	/** Already settled, by an earlier run or by watching after rewards shipped. */
	alreadyRewarded: number;
	/** No Offcoin link, so nothing could be paid. Their reward stays claimable. */
	skippedNoOffcoin: number;
	/** Total ECO and XP this run moved (or would move, on a dry run). */
	totalEco: number;
	totalXp: number;
	/**
	 * Who was (or would be) paid. Read this before a real run — it is the list of
	 * people about to receive tokens, and the only chance to check it beforehand.
	 */
	recipients: {
		userId: string;
		name: string;
		email: string;
		watchedAt: string;
		eco: number;
		xp: number;
		/** Exited members are still paid; flagged so the choice stays visible. */
		exited: boolean;
	}[];
	failed: { email: string; error: string }[];
}

export async function backfillWayfinderRewards(
	actorUserId: string | null,
	dryRun = false
): Promise<WayfinderBackfillResult> {
	const result: WayfinderBackfillResult = {
		total: 0,
		rewarded: 0,
		alreadyRewarded: 0,
		skippedNoOffcoin: 0,
		totalEco: 0,
		totalXp: 0,
		recipients: [],
		failed: []
	};

	const video = findWayfinderVideo(WELCOME_VIDEO_ID);
	if (!video) return result;

	const eco = video.rewardEco;
	const xp = xpFromEco(eco);

	const watchers = await db.select().from(userTable).where(isNotNull(userTable.introWatchedAt));
	result.total = watchers.length;

	for (const member of watchers) {
		const watchedAt = member.introWatchedAt!;
		const entry = {
			userId: member.id,
			name: member.name,
			email: member.email,
			watchedAt: watchedAt.toISOString(),
			eco,
			xp,
			exited: member.membershipStatus === 'exited'
		};

		if (!member.puckstackUserId) {
			result.skippedNoOffcoin++;
			continue;
		}

		if (dryRun) {
			// Report against the stored row rather than guessing: someone who
			// watched after rewards shipped has already been paid, and listing
			// them here would overstate what a real run is about to move.
			const existing = await db.query.wayfinderWatches.findFirst({
				where: (w, { and, eq }) => and(eq(w.userId, member.id), eq(w.videoId, WELCOME_VIDEO_ID))
			});
			if (existing?.rewardClaimedAt) {
				result.alreadyRewarded++;
				continue;
			}
			result.rewarded++;
			result.totalEco += eco;
			result.totalXp += xp;
			result.recipients.push(entry);
			continue;
		}

		try {
			// The watch row has to exist before it can be claimed — for a member
			// who predates the table there is nothing to pay against yet. Dated to
			// when they actually watched, and conflict-tolerant so a member who
			// already has a row keeps theirs untouched.
			await db
				.insert(wayfinderWatches)
				.values({ userId: member.id, videoId: WELCOME_VIDEO_ID, watchedAt })
				.onConflictDoNothing();

			const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

			if (outcome.status === 'granted') {
				result.rewarded++;
				result.totalEco += outcome.reward.eco;
				result.totalXp += outcome.reward.xp;
				result.recipients.push({ ...entry, ...outcome.reward });
			} else if (outcome.status === 'already') {
				result.alreadyRewarded++;
			} else if (outcome.status === 'skipped') {
				// The only skip reachable here is a missing Offcoin record — the
				// catalogue and reward amount were checked above.
				result.skippedNoOffcoin++;
			} else {
				result.failed.push({ email: member.email, error: outcome.reason });
			}
		} catch (err) {
			result.failed.push({
				email: member.email,
				error: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}

	apiLogger.info(
		{
			actorUserId,
			dryRun,
			total: result.total,
			rewarded: result.rewarded,
			alreadyRewarded: result.alreadyRewarded,
			skippedNoOffcoin: result.skippedNoOffcoin,
			totalEco: result.totalEco,
			totalXp: result.totalXp,
			failed: result.failed.length
		},
		'Wayfinder reward backfill'
	);

	return result;
}
