/**
 * The welcome-video reward backfill against a real database.
 *
 * This is the one piece of Wayfinder that moves tokens into existing members'
 * balances in bulk, so the properties that matter are: it pays the right people
 * once, a second run pays nobody, and a dry run moves nothing at all.
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

const { backfillWayfinderRewards } = await import('./wayfinder-backfill');
const { settleUnclaimedRewards } = await import('./wayfinder-rewards');
const { WELCOME_VIDEO_ID, findWayfinderVideo } = await import('$lib/wayfinder/videos');

const WELCOME_ECO = findWayfinderVideo(WELCOME_VIDEO_ID)!.rewardEco;
const WELCOME_XP = Math.round(WELCOME_ECO * 1.5);

const WATCHED_AT = new Date('2026-03-01T09:00:00.000Z');

beforeEach(async () => {
	vi.clearAllMocks();
	// Unlike the per-member tests elsewhere, these assert on run totals — so
	// each one needs the whole population to itself. Deleting the users cascades
	// to their watch rows.
	await db.delete(schema.wayfinderWatches);
	await db.delete(schema.user);
	resolveMemberAlias.mockImplementation(async (id: string) => `puckstack:ws:${id}`);
	members.addTokens.mockResolvedValue({ transactionId: 'eco-tx' });
	members.addXp.mockResolvedValue({
		transactionId: 'xp-tx',
		newXp: 150,
		level: 2,
		previousLevel: 1
	});
});

function watchRow(userId: string) {
	return db.query.wayfinderWatches.findFirst({
		where: and(
			eq(schema.wayfinderWatches.userId, userId),
			eq(schema.wayfinderWatches.videoId, WELCOME_VIDEO_ID)
		)
	});
}

describe('a dry run', () => {
	it('reports who would be paid without moving anything', async () => {
		const member = await seedUser(db, { introWatchedAt: WATCHED_AT });

		const result = await backfillWayfinderRewards('admin', true);

		expect(result.rewarded).toBe(1);
		expect(result.totalEco).toBe(WELCOME_ECO);
		expect(result.totalXp).toBe(WELCOME_XP);
		expect(result.recipients).toContainEqual(
			expect.objectContaining({ userId: member.id, eco: WELCOME_ECO, xp: WELCOME_XP })
		);

		// Nothing written, nothing sent — that is the whole contract of a dry run.
		expect(members.addTokens).not.toHaveBeenCalled();
		expect(await watchRow(member.id)).toBeUndefined();
	});
});

describe('a real run', () => {
	it('pays the reward and dates the watch to when they actually watched', async () => {
		const member = await seedUser(db, { introWatchedAt: WATCHED_AT });

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.rewarded).toBe(1);
		// Both ledgers, not just ECO — a member credited tokens but no XP has
		// been shortchanged on the half that decides their membership level.
		expect(members.addTokens).toHaveBeenCalledTimes(1);
		expect(members.addXp).toHaveBeenCalledTimes(1);

		const row = await watchRow(member.id);
		// Not `now` — the backfill must not rewrite history to the day it ran.
		expect(row?.watchedAt).toEqual(WATCHED_AT);
		expect(row?.rewardEco).toBe(WELCOME_ECO);
		expect(row?.rewardXp).toBe(WELCOME_XP);
	});

	it('pays nobody on a second run', async () => {
		await seedUser(db, { introWatchedAt: WATCHED_AT });
		await backfillWayfinderRewards('admin', false);
		vi.clearAllMocks();

		const second = await backfillWayfinderRewards('admin', false);

		expect(second.rewarded).toBe(0);
		expect(second.alreadyRewarded).toBe(1);
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('leaves members who never watched alone', async () => {
		const never = await seedUser(db, { introWatchedAt: null });

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.recipients.map((r) => r.userId)).not.toContain(never.id);
		expect(await watchRow(never.id)).toBeUndefined();
	});

	it('skips a member with no Offcoin link, leaving the reward claimable', async () => {
		const member = await seedUser(db, {
			introWatchedAt: WATCHED_AT,
			puckstackUserId: null
		});

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.skippedNoOffcoin).toBe(1);
		expect(result.recipients.map((r) => r.userId)).not.toContain(member.id);
		// The row must exist even though nobody could be paid: it is the thing
		// that holds the unclaimed reward. Without it there is nothing for
		// settleUnclaimedRewards to find, and the reward is destroyed rather than
		// deferred — the member can never re-trigger it, because the client
		// already shows the welcome video as watched via introWatchedAt.
		const row = await watchRow(member.id);
		expect(row).toBeDefined();
		expect(row?.rewardClaimedAt ?? null).toBeNull();
	});

	it('pays a skipped member once they connect Offcoin', async () => {
		// The end-to-end version of the case above: backfill first, link later.
		const member = await seedUser(db, {
			introWatchedAt: WATCHED_AT,
			puckstackUserId: null
		});
		await backfillWayfinderRewards('admin', false);
		expect(members.addTokens).not.toHaveBeenCalled();

		await db
			.update(schema.user)
			.set({ puckstackUserId: 'ps-linked-later' })
			.where(eq(schema.user.id, member.id));

		const total = await settleUnclaimedRewards(member.id);

		expect(total.eco).toBe(WELCOME_ECO);
		expect(total.xp).toBe(WELCOME_XP);
		expect(members.addTokens).toHaveBeenCalledTimes(1);
		expect(members.addXp).toHaveBeenCalledTimes(1);
	});

	it('does not re-pay someone who earned it by watching after rewards shipped', async () => {
		// Their watch row already exists and is settled — the backfill's insert is
		// conflict-tolerant, so it must find the claim taken and move on.
		const member = await seedUser(db, { introWatchedAt: WATCHED_AT });
		await db.insert(schema.wayfinderWatches).values({
			userId: member.id,
			videoId: WELCOME_VIDEO_ID,
			watchedAt: new Date(),
			rewardClaimedAt: new Date(),
			rewardedAt: new Date(),
			rewardEco: WELCOME_ECO,
			rewardXp: WELCOME_XP
		});

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.rewarded).toBe(0);
		expect(result.alreadyRewarded).toBe(1);
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('records a failure without stopping the rest of the run', async () => {
		const broken = await seedUser(db, { introWatchedAt: WATCHED_AT });
		const fine = await seedUser(db, { introWatchedAt: WATCHED_AT });
		resolveMemberAlias.mockImplementation(async (id: string) => {
			if (id === broken.puckstackUserId) throw new Error('ECONNRESET');
			return `puckstack:ws:${id}`;
		});

		const result = await backfillWayfinderRewards('admin', false);

		// One member's outage must not cost everyone else their reward.
		expect(result.failed).toHaveLength(1);
		expect(result.rewarded).toBe(1);
		expect(result.recipients.map((r) => r.userId)).toContain(fine.id);
	});

	it('reports a payout that died between claiming and settling', async () => {
		// The crash case: the claim was taken, then the process went away before
		// the settlement write. Nothing else in the system looks for these, so
		// the backfill report is the only place they surface.
		const member = await seedUser(db, { introWatchedAt: WATCHED_AT });
		await db.insert(schema.wayfinderWatches).values({
			userId: member.id,
			videoId: WELCOME_VIDEO_ID,
			watchedAt: WATCHED_AT,
			rewardClaimedAt: new Date('2026-03-02T09:00:00.000Z'),
			rewardedAt: null
		});

		const result = await backfillWayfinderRewards('admin', true);

		expect(result.stuckClaims).toContainEqual(
			expect.objectContaining({ userId: member.id, videoId: WELCOME_VIDEO_ID })
		);
		// Not re-paid — the claim is still held — but not counted as settled
		// either. Reporting it as "already rewarded" would tell an admin this
		// member had been paid when nobody has been.
		expect(result.rewarded).toBe(0);
		expect(result.alreadyRewarded).toBe(0);
	});

	it('does not count a stuck claim as settled on a real run either', async () => {
		// The real path learns the same thing from `rewardVideoWatch` returning
		// 'already', which covers both settled and stuck rows — so the two have
		// to be told apart there too, not just in the dry run.
		const member = await seedUser(db, { introWatchedAt: WATCHED_AT });
		await db.insert(schema.wayfinderWatches).values({
			userId: member.id,
			videoId: WELCOME_VIDEO_ID,
			watchedAt: WATCHED_AT,
			rewardClaimedAt: new Date('2026-03-02T09:00:00.000Z'),
			rewardedAt: null
		});

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.alreadyRewarded).toBe(0);
		expect(result.rewarded).toBe(0);
		expect(result.stuckClaims).toHaveLength(1);
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('still pays members who have left, and flags them', async () => {
		// A deliberate choice rather than an oversight: they did the watching.
		// Flagged in the report so the choice stays visible to whoever runs it.
		const member = await seedUser(db, {
			introWatchedAt: WATCHED_AT,
			membershipStatus: 'exited'
		});

		const result = await backfillWayfinderRewards('admin', false);

		expect(result.recipients).toContainEqual(
			expect.objectContaining({ userId: member.id, exited: true })
		);
	});
});
