/**
 * Wayfinder video rewards against a real database.
 *
 * The whole point of this module is a guarantee — a member cannot be paid twice
 * for the same video, ever — and that guarantee lives in the database rather
 * than in the control flow. So it can only be tested against real rows: a mock
 * would just replay whatever ordering the test imagined.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { and, eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

class NotFound extends Error {}
vi.mock('@offcoin/sdk', () => ({ NotFoundError: NotFound }));

const members = vi.hoisted(() => ({ addTokens: vi.fn(), addXp: vi.fn() }));
const resolveMemberAlias = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	memberAlias: (id: string) => `puckstack:ws:${id}`,
	resolveMemberAlias
}));

vi.mock('$lib/server/discord', () => ({ sendDiscordMessage: vi.fn(async () => true) }));

const { rewardVideoWatch, settleUnclaimedRewards } = await import('./wayfinder-rewards');
const { WELCOME_VIDEO_ID, findWayfinderVideo } = await import('$lib/wayfinder/videos');

/** The welcome video's configured payout, so the tests follow the catalogue. */
const WELCOME_ECO = findWayfinderVideo(WELCOME_VIDEO_ID)!.rewardEco;
const WELCOME_XP = Math.round(WELCOME_ECO * 1.5);

beforeEach(() => {
	vi.clearAllMocks();
	resolveMemberAlias.mockImplementation(async (id: string) => `puckstack:ws:${id}`);
	members.addTokens.mockResolvedValue({ transactionId: 'eco-tx' });
	members.addXp.mockResolvedValue({
		transactionId: 'xp-tx',
		newXp: 150,
		level: 2,
		previousLevel: 1
	});
});

/** A member with a watch row for the welcome video, ready to be paid. */
async function watcher(over: Record<string, unknown> = {}) {
	const member = await seedUser(db, over);
	await db
		.insert(schema.wayfinderWatches)
		.values({ userId: member.id, videoId: WELCOME_VIDEO_ID, watchedAt: new Date() });
	return member;
}

function watchRow(userId: string) {
	return db.query.wayfinderWatches.findFirst({
		where: and(
			eq(schema.wayfinderWatches.userId, userId),
			eq(schema.wayfinderWatches.videoId, WELCOME_VIDEO_ID)
		)
	});
}

describe('paying for a watched video', () => {
	it('moves both currencies and records what was paid', async () => {
		const member = await watcher();

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(outcome).toEqual({
			status: 'granted',
			reward: { eco: WELCOME_ECO, xp: WELCOME_XP }
		});

		const row = await watchRow(member.id);
		expect(row?.rewardedAt).toBeInstanceOf(Date);
		expect(row?.rewardEco).toBe(WELCOME_ECO);
		expect(row?.rewardXp).toBe(WELCOME_XP);
		expect(row?.offcoinEcoTxId).toBe('eco-tx');
		expect(row?.offcoinXpTxId).toBe('xp-tx');
	});

	it('refreshes the local level snapshot so gates do not lag', async () => {
		const member = await watcher();

		await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		const [row] = await db.select().from(schema.user).where(eq(schema.user.id, member.id));
		expect(row.offcoinLevel).toBe(2);
	});
});

describe('the once-only guarantee', () => {
	it('pays nothing the second time, and does not touch Offcoin', async () => {
		const member = await watcher();
		await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		vi.clearAllMocks();

		const second = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(second).toEqual({ status: 'already' });
		// The important half: not merely "returned already", but never asked
		// Offcoin to move anything.
		expect(members.addTokens).not.toHaveBeenCalled();
		expect(members.addXp).not.toHaveBeenCalled();
	});

	it('pays once when two requests race', async () => {
		const member = await watcher();

		// Two tabs, a double-click, or a retried request. Exactly one may win.
		const outcomes = await Promise.all([
			rewardVideoWatch(member.id, WELCOME_VIDEO_ID),
			rewardVideoWatch(member.id, WELCOME_VIDEO_ID)
		]);

		expect(outcomes.filter((o) => o.status === 'granted')).toHaveLength(1);
		expect(outcomes.filter((o) => o.status === 'already')).toHaveLength(1);
		expect(members.addTokens).toHaveBeenCalledTimes(1);
	});

	it('will not pay for a video with no watch row', async () => {
		// Nothing to claim means nothing to pay — the row is the evidence that
		// the video was actually watched.
		const member = await seedUser(db);

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(outcome).toEqual({ status: 'already' });
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('refuses a video that is not in the catalogue', async () => {
		const member = await watcher();

		const outcome = await rewardVideoWatch(member.id, 'not-a-video');

		expect(outcome).toEqual({
			status: 'skipped',
			reason: 'Video is not in the catalogue'
		});
	});
});

describe('when the member cannot be paid', () => {
	it('leaves the reward claimable for someone who has not connected Offcoin', async () => {
		const member = await watcher({ puckstackUserId: null });

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(outcome).toEqual({
			status: 'skipped',
			reason: 'Member has not connected Offcoin yet'
		});
		// Unclaimed, so linking Offcoin later still earns them the reward rather
		// than silently forfeiting it.
		const row = await watchRow(member.id);
		expect(row?.rewardClaimedAt).toBeNull();
	});

	it('hands the claim back when Offcoin is unreachable, so a retry works', async () => {
		const member = await watcher();
		resolveMemberAlias.mockRejectedValueOnce(new Error('ECONNRESET'));

		const first = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		expect(first).toEqual({
			status: 'failed',
			reason: 'Offcoin is unreachable',
			partial: false
		});
		expect((await watchRow(member.id))?.rewardClaimedAt).toBeNull();

		// An outage must not cost the member their reward permanently.
		const retry = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		expect(retry.status).toBe('granted');
	});

	it('reports a missing Offcoin record separately from an outage', async () => {
		// These two must not be conflated: "no Offcoin record" sends a steward off
		// to fix a link, and saying that during an outage sends them after a link
		// that was never broken.
		const member = await watcher();
		resolveMemberAlias.mockRejectedValueOnce(new NotFound('no such member'));

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(outcome).toEqual({
			status: 'skipped',
			reason: 'Member has no Offcoin record'
		});
		expect((await watchRow(member.id))?.rewardClaimedAt).toBeNull();
	});

	it('hands the claim back when Offcoin rejects the ECO outright', async () => {
		const member = await watcher();
		members.addTokens.mockRejectedValueOnce(new Error('rejected'));

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);

		expect(outcome).toEqual({
			status: 'failed',
			reason: 'Offcoin rejected the reward',
			partial: false
		});
		expect((await watchRow(member.id))?.rewardClaimedAt).toBeNull();
	});

	it('keeps the claim when only half landed, and never repeats it', async () => {
		const member = await watcher();
		members.addXp.mockRejectedValueOnce(new Error('xp exploded'));

		const outcome = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		expect(outcome).toEqual({
			status: 'failed',
			reason: 'The ECO went through but the XP did not',
			partial: true
		});

		// What actually landed is recorded, so the gap is visible to whoever
		// reconciles it rather than lost.
		const row = await watchRow(member.id);
		expect(row?.rewardEco).toBe(WELCOME_ECO);
		expect(row?.rewardXp).toBe(0);
		expect(row?.offcoinEcoTxId).toBe('eco-tx');
		expect(row?.offcoinXpTxId).toBeNull();

		// And a retry must not hand out the ECO a second time to fix the XP.
		vi.clearAllMocks();
		const retry = await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		expect(retry).toEqual({ status: 'already' });
		expect(members.addTokens).not.toHaveBeenCalled();
	});
});

describe('settling what was earned before linking Offcoin', () => {
	it('pays every unclaimed video once the member finally connects', async () => {
		// The realistic case: the welcome video auto-opens on their first load,
		// long before they have an Offcoin account to be paid into.
		const member = await seedUser(db, { puckstackUserId: null });
		for (const videoId of [WELCOME_VIDEO_ID, 'voting']) {
			await db
				.insert(schema.wayfinderWatches)
				.values({ userId: member.id, videoId, watchedAt: new Date() });
			await rewardVideoWatch(member.id, videoId);
		}
		// Nothing could be paid, and nothing was claimed.
		expect(members.addTokens).not.toHaveBeenCalled();

		// They link Offcoin.
		await db
			.update(schema.user)
			.set({ puckstackUserId: 'ps-linked' })
			.where(eq(schema.user.id, member.id));

		const total = await settleUnclaimedRewards(member.id);

		const votingEco = findWayfinderVideo('voting')!.rewardEco;
		expect(total.eco).toBe(WELCOME_ECO + votingEco);
		expect(members.addTokens).toHaveBeenCalledTimes(2);
	});

	it('pays nothing when everything is already settled', async () => {
		const member = await watcher();
		await rewardVideoWatch(member.id, WELCOME_VIDEO_ID);
		vi.clearAllMocks();

		const total = await settleUnclaimedRewards(member.id);

		expect(total).toEqual({ eco: 0, xp: 0 });
		expect(members.addTokens).not.toHaveBeenCalled();
	});
});
