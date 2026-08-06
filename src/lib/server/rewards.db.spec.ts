/**
 * grantReward against a real database.
 *
 * The pure maths lives in rewards.spec.ts. What needs a database is the audit
 * row — specifically what gets written when a grant only half completes, since
 * that row is both the record of what a member received and the input to the
 * actor's daily cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const members = vi.hoisted(() => ({ addTokens: vi.fn(), addXp: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	memberAlias: (id: string) => `puckstack:ws:${id}`
}));

const discord = vi.hoisted(() => ({ sendDiscordMessage: vi.fn(async () => true) }));
vi.mock('$lib/server/discord', () => discord);

const { grantReward, xpGrantedToday } = await import('./rewards');

const REASON = 'Ran the community call all quarter';

beforeEach(() => {
	vi.clearAllMocks();
	members.addTokens.mockResolvedValue({ transactionId: 'eco-tx' });
	members.addXp.mockResolvedValue({
		transactionId: 'xp-tx',
		newXp: 150,
		level: 3,
		previousLevel: 2
	});
	discord.sendDiscordMessage.mockResolvedValue(true);
});

/** Grants written by one actor — the fixture database is shared across tests. */
function grantsBy(actorUserId: string) {
	return db
		.select()
		.from(schema.rewardGrants)
		.where(eq(schema.rewardGrants.actorUserId, actorUserId));
}

async function pair() {
	const actor = await seedUser(db);
	const recipient = await seedUser(db, { puckstackUserId: 'ps-r' });
	return { actor, recipient };
}

describe('a grant that completes', () => {
	it('records both halves and reports the level-up', async () => {
		const { actor, recipient } = await pair();

		const result = await grantReward({
			recipientUserId: recipient.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(true);
		expect(result.levelledUp).toBe(true);
		const [row] = await grantsBy(actor.id);
		expect(row).toMatchObject({
			eco: 10,
			xp: 15,
			offcoinEcoTxId: 'eco-tx',
			offcoinXpTxId: 'xp-tx'
		});
	});

	it('counts toward the actor daily cap', async () => {
		const { actor, recipient } = await pair();
		await grantReward({
			recipientUserId: recipient.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(await xpGrantedToday(actor.id)).toBe(15);
	});
});

describe('a grant that only half completes', () => {
	it('records the ECO alone when the XP call fails', async () => {
		const { actor, recipient } = await pair();
		members.addXp.mockRejectedValue(new Error('offcoin down'));

		const result = await grantReward({
			recipientUserId: recipient.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(false);
		const [row] = await grantsBy(actor.id);
		expect(row).toMatchObject({ eco: 10, xp: 0, offcoinEcoTxId: 'eco-tx', offcoinXpTxId: null });
	});

	it('still records XP that landed before a later failure', async () => {
		// The regression. The snapshot write sits after both Offcoin calls, so a
		// database hiccup throws with the XP already granted. Recording xp: 0
		// there understates what the member received and leaves room under the
		// actor's daily cap for XP that has already gone out.
		const { actor, recipient } = await pair();
		const realUpdate = db.update.bind(db);
		const spy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw new Error('database is locked');
		});

		const result = await grantReward({
			recipientUserId: recipient.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});
		spy.mockRestore();
		void realUpdate;

		expect(result.ok).toBe(false);
		const [row] = await grantsBy(actor.id);
		expect(row).toMatchObject({
			eco: 10,
			xp: 15,
			offcoinEcoTxId: 'eco-tx',
			offcoinXpTxId: 'xp-tx'
		});
		expect(await xpGrantedToday(actor.id)).toBe(15);
	});

	it('writes nothing when Offcoin refuses the first call', async () => {
		const { actor, recipient } = await pair();
		members.addTokens.mockRejectedValue(new Error('rejected'));

		const result = await grantReward({
			recipientUserId: recipient.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(false);
		expect(await grantsBy(actor.id)).toHaveLength(0);
	});
});

describe('who may receive', () => {
	it('refuses a member who has left', async () => {
		const actor = await seedUser(db);
		const gone = await seedUser(db, { puckstackUserId: 'ps-x', membershipStatus: 'exited' });

		const result = await grantReward({
			recipientUserId: gone.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(false);
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('refuses someone who has not connected Offcoin', async () => {
		const actor = await seedUser(db);
		const unlinked = await seedUser(db, { puckstackUserId: null });

		const result = await grantReward({
			recipientUserId: unlinked.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(false);
		expect(members.addTokens).not.toHaveBeenCalled();
	});

	it('refuses a self-grant before touching Offcoin', async () => {
		const actor = await seedUser(db, { puckstackUserId: 'ps-a' });

		const result = await grantReward({
			recipientUserId: actor.id,
			actorUserId: actor.id,
			eco: 10,
			reason: REASON
		});

		expect(result.ok).toBe(false);
		expect(members.addTokens).not.toHaveBeenCalled();
	});
});
