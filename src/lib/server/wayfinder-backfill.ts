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
 * - Members who have not connected Offcoin still get their watch row, with the
 *   reward left unclaimed on it, so `settleUnclaimedRewards` can pay them the
 *   moment they link an account. The row is the thing that holds the reward —
 *   without it there is nothing for that sweep to find.
 * - The watch row is dated to `introWatchedAt`, not to now, so the backfill does
 *   not rewrite when people actually watched.
 */

import { db } from '$lib/server/db';
import { user as userTable, wayfinderWatches } from '$lib/server/db/schema';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
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
	/**
	 * Rows claimed but never settled — a payout that died mid-flight, e.g. the
	 * process was killed between the Offcoin call and the write recording it.
	 *
	 * Reported rather than retried, deliberately. Whether the member was
	 * actually credited is only knowable from Offcoin's own ledger, and
	 * releasing the claim on a payout that did land would pay them twice —
	 * exactly what the claim exists to prevent. Anything listed here needs a
	 * human to check Offcoin and then clear or settle the row by hand.
	 */
	stuckClaims: { userId: string; videoId: string; claimedAt: string }[];
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
		stuckClaims: [],
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

	// Payouts that died between claiming and settling. Swept over the whole
	// table rather than just the welcome video, because this report is the only
	// place they are visible — nothing else looks for them.
	const stuck = await db
		.select({
			userId: wayfinderWatches.userId,
			videoId: wayfinderWatches.videoId,
			claimedAt: wayfinderWatches.rewardClaimedAt
		})
		.from(wayfinderWatches)
		.where(and(isNotNull(wayfinderWatches.rewardClaimedAt), isNull(wayfinderWatches.rewardedAt)));
	result.stuckClaims = stuck.map((row) => ({
		userId: row.userId,
		videoId: row.videoId,
		claimedAt: row.claimedAt!.toISOString()
	}));

	// Every existing welcome-video row in one query rather than one per member.
	// Only the dry run consults this — a real run lets the reward claim itself
	// answer the question, since that is the only answer that cannot race.
	const existingByUser = new Map<string, { rewardClaimedAt: Date | null }>();
	if (dryRun) {
		const rows = await db
			.select({
				userId: wayfinderWatches.userId,
				rewardClaimedAt: wayfinderWatches.rewardClaimedAt
			})
			.from(wayfinderWatches)
			.where(eq(wayfinderWatches.videoId, WELCOME_VIDEO_ID));
		for (const row of rows) existingByUser.set(row.userId, row);
	}

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

		if (dryRun) {
			// Report against the stored row rather than guessing: someone who
			// watched after rewards shipped has already been paid, and listing
			// them here would overstate what a real run is about to move.
			if (existingByUser.get(member.id)?.rewardClaimedAt) {
				result.alreadyRewarded++;
				continue;
			}
			if (!member.puckstackUserId) {
				result.skippedNoOffcoin++;
				continue;
			}
			result.rewarded++;
			result.totalEco += eco;
			result.totalXp += xp;
			result.recipients.push(entry);
			continue;
		}

		try {
			// The watch row is created for *everyone* who watched, including
			// members with no Offcoin link yet — deliberately before the payment
			// attempt below.
			//
			// The row is what holds the unclaimed reward. Skipping its creation for
			// an unlinked member does not defer their reward, it destroys it:
			// `settleUnclaimedRewards` sweeps watch rows, so with no row there is
			// nothing for it to find when they finally connect, and they can never
			// re-trigger it by watching again either — `getWatchedVideos` folds
			// `introWatchedAt` in, so the client already shows the video as watched
			// and never posts.
			//
			// Dated to when they actually watched, and conflict-tolerant so a
			// member who already has a row keeps theirs untouched.
			await db
				.insert(wayfinderWatches)
				.values({ userId: member.id, videoId: WELCOME_VIDEO_ID, watchedAt })
				.onConflictDoNothing();

			// Now the reward is safely claimable, an unlinked member can be passed
			// over: `rewardVideoWatch` leaves the claim untaken for them.
			const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

			if (outcome.status === 'granted') {
				result.rewarded++;
				result.totalEco += outcome.reward.eco;
				result.totalXp += outcome.reward.xp;
				result.recipients.push({ ...entry, ...outcome.reward });
			} else if (outcome.status === 'already') {
				result.alreadyRewarded++;
			} else if (outcome.status === 'skipped') {
				// Either no Offcoin link yet or no Offcoin record behind it. Both
				// leave the claim untaken on the row written above, so both are
				// "waiting to be paid" rather than a failure. The catalogue and
				// reward amount were checked before the loop.
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
			stuckClaims: result.stuckClaims.length,
			totalEco: result.totalEco,
			totalXp: result.totalXp,
			failed: result.failed.length
		},
		'Wayfinder reward backfill'
	);

	return result;
}
