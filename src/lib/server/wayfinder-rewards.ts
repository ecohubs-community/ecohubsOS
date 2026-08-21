/**
 * Paying members for finishing a Wayfinder video.
 *
 * Deliberately not routed through {@link grantReward}. That function models one
 * person recognising another: it needs a human actor, refuses self-grants, caps
 * what an actor may hand out in a day, and announces every grant in Discord.
 * None of that describes a video reward, and forcing it through would either
 * exhaust a system actor's daily cap or bury real recognition under automated
 * noise. What it does share is the ratio — one ECO number sets both currencies,
 * so a video is worth the same here as anywhere else.
 *
 * The hard requirement is that a member cannot be paid twice for the same
 * video, ever — not by double-clicking, not by two tabs, not by a retried
 * request, and not by a backfill run twice. That guarantee lives in the
 * database, not in this code's control flow: the unique index on
 * (user_id, video_id) means there is exactly one row to claim, and the claim is
 * an UPDATE conditional on `reward_claimed_at` still being null. Whoever's
 * update reports a row owns the payout. Everyone else stops.
 */

import { db } from '$lib/server/db';
import { user as userTable, wayfinderWatches } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { getOffcoinClient, resolveMemberAlias } from '$lib/server/offcoin';
import { NotFoundError } from '@offcoin/sdk';
import { xpFromEco } from '$lib/server/rewards';
import { findWayfinderVideo } from '$lib/wayfinder/videos';
import { recordParticipation } from '$lib/server/participation';
import { apiLogger } from '$lib/server/logger';

export interface VideoReward {
	eco: number;
	xp: number;
}

export type RewardOutcome =
	/** Paid just now. The only case that should raise a toast. */
	| { status: 'granted'; reward: VideoReward }
	/** Already settled, or claimed by someone else. Not an error. */
	| { status: 'already' }
	/** Nothing was owed or nothing could be paid — see `reason`. */
	| { status: 'skipped'; reason: string }
	/** Something went wrong mid-payout; `partial` means ECO landed and XP did not. */
	| { status: 'failed'; reason: string; partial: boolean };

/**
 * Pay a member for a video they have already been recorded as watching.
 *
 * Expects the watch row to exist — {@link markVideoWatched} writes it first, so
 * that the thing being claimed is the same row that proves the watch. Returns
 * `skipped` rather than throwing when there is nothing to do, because every
 * caller here is a side effect of some other action succeeding.
 */
export async function rewardVideoWatch(userId: string, videoId: string): Promise<RewardOutcome> {
	const video = findWayfinderVideo(videoId);
	if (!video) return { status: 'skipped', reason: 'Video is not in the catalogue' };
	if (video.rewardEco <= 0) return { status: 'skipped', reason: 'Video carries no reward' };

	const member = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
	if (!member) return { status: 'skipped', reason: 'Member not found' };

	// Nothing to pay into yet. Deliberately leaves the claim untaken, so the
	// reward is still waiting once they connect Offcoin — the alternative
	// silently forfeits it for every member who watches before linking.
	if (!member.puckstackUserId) {
		return { status: 'skipped', reason: 'Member has not connected Offcoin yet' };
	}

	const eco = video.rewardEco;
	const xp = xpFromEco(eco);
	const now = new Date();

	// The claim. Conditional on `rewardClaimedAt` still being null, so this is
	// the one and only serialisation point — if two requests race, exactly one
	// gets a row back.
	const claimed = await db
		.update(wayfinderWatches)
		.set({ rewardClaimedAt: now })
		.where(
			and(
				eq(wayfinderWatches.userId, userId),
				eq(wayfinderWatches.videoId, videoId),
				isNull(wayfinderWatches.rewardClaimedAt)
			)
		)
		.returning({ id: wayfinderWatches.id });

	if (claimed.length === 0) {
		// Either already paid, or another request is mid-payout, or the watch row
		// does not exist. None of these should pay out now.
		return { status: 'already' };
	}

	const claimId = claimed[0].id;

	/** Hand the claim back so a later run can retry. Only safe when nothing landed. */
	const releaseClaim = () =>
		db
			.update(wayfinderWatches)
			.set({ rewardClaimedAt: null })
			.where(eq(wayfinderWatches.id, claimId));

	// Settled before anything is written, for the same reason grantReward does
	// it: the two Offcoin calls are not idempotent, so the alias must not still
	// be in question once ECO has moved.
	let alias: string;
	try {
		alias = await resolveMemberAlias(member.puckstackUserId);
	} catch (err) {
		// Nothing has moved yet, so the claim goes back either way.
		await releaseClaim();
		apiLogger.error({ err, userId, videoId }, 'Wayfinder reward: member could not be resolved');
		// Only a NotFoundError says anything about the member. Reporting an
		// outage as "no Offcoin record" would send a steward off to fix a link
		// that was never broken.
		return err instanceof NotFoundError
			? { status: 'skipped', reason: 'Member has no Offcoin record' }
			: { status: 'failed', reason: 'Offcoin is unreachable', partial: false };
	}

	const note = `Wayfinder: ${video.title}`;
	let ecoTxId: string | null = null;
	let xpTxId: string | null = null;

	try {
		// ECO first, as in grantReward: it is the reversible half. If XP then
		// fails we have given someone tokens rather than rights.
		ecoTxId = (await getOffcoinClient().members.addTokens(alias, eco, note)).transactionId;

		const xpResult = await getOffcoinClient().members.addXp(alias, xp, note);
		xpTxId = xpResult.transactionId;

		// Keep the local snapshot fresh so level gates do not lag behind.
		await db
			.update(userTable)
			.set({
				offcoinXp: xpResult.newXp,
				offcoinLevel: xpResult.level,
				offcoinSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(userTable.id, userId));
	} catch (err) {
		apiLogger.error({ err, userId, videoId, ecoTxId, xpTxId }, 'Wayfinder reward failed');

		if (!ecoTxId && !xpTxId) {
			// Nothing moved, so the claim is safe to hand back and retry later.
			await releaseClaim();
			return { status: 'failed', reason: 'Offcoin rejected the reward', partial: false };
		}

		// Something landed. Keep the claim — repeating this would pay twice — and
		// record what actually went through so the gap is visible rather than lost.
		await db
			.update(wayfinderWatches)
			.set({
				rewardedAt: new Date(),
				rewardEco: ecoTxId ? eco : 0,
				rewardXp: xpTxId ? xp : 0,
				offcoinEcoTxId: ecoTxId,
				offcoinXpTxId: xpTxId
			})
			.where(eq(wayfinderWatches.id, claimId));

		return {
			status: 'failed',
			reason: 'The ECO went through but the XP did not',
			partial: true
		};
	}

	await db
		.update(wayfinderWatches)
		.set({
			rewardedAt: new Date(),
			rewardEco: eco,
			rewardXp: xp,
			offcoinEcoTxId: ecoTxId,
			offcoinXpTxId: xpTxId
		})
		.where(eq(wayfinderWatches.id, claimId));

	// Learning your way around is taking part.
	void recordParticipation(userId, 'offcoin_xp');

	apiLogger.info({ userId, videoId, eco, xp }, 'Wayfinder video reward granted');

	return { status: 'granted', reward: { eco, xp } };
}

/**
 * Pay out everything this member earned before they could be paid.
 *
 * A member can finish videos before linking Offcoin — the welcome video
 * auto-opens on their very first load, which is usually before they have
 * connected anything. Those watches are recorded with the reward left
 * deliberately unclaimed, and this is what collects them once there is finally
 * an account to pay into.
 *
 * Without this the reward would sit unclaimed forever: nothing re-posts a watch
 * the member has already completed, so the money would simply never arrive.
 *
 * Best-effort by design. It runs off the back of linking an Offcoin account,
 * and a payout problem must not make the member think the link itself failed.
 */
export async function settleUnclaimedRewards(userId: string): Promise<VideoReward> {
	const pending = await db
		.select({ videoId: wayfinderWatches.videoId })
		.from(wayfinderWatches)
		.where(and(eq(wayfinderWatches.userId, userId), isNull(wayfinderWatches.rewardClaimedAt)));

	const total: VideoReward = { eco: 0, xp: 0 };

	for (const { videoId } of pending) {
		// Sequential rather than parallel: these are non-idempotent writes against
		// one member's balance, and there is no hurry.
		const outcome = await rewardVideoWatch(userId, videoId);
		if (outcome.status === 'granted') {
			total.eco += outcome.reward.eco;
			total.xp += outcome.reward.xp;
		}
	}

	if (total.eco > 0) {
		apiLogger.info({ userId, ...total }, 'Settled Wayfinder rewards earned before linking');
	}

	return total;
}
