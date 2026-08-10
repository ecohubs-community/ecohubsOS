/**
 * Reading levels back from Offcoin.
 *
 * The point of the sync is to make "level 0" and "never looked" distinguishable,
 * so these cover that a genuine 0 is stored, and that the report answers the
 * question it exists for: who holds membership while under the level that earns
 * it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { POLICY, ROLE_GROUPS } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

class NotFound extends Error {}
vi.mock('@offcoin/sdk', () => ({ NotFoundError: NotFound }));

const members = vi.hoisted(() => ({ getXp: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	memberAlias: (id: string) => `puckstack:ws:${id}`
}));

const { syncOffcoinLevels } = await import('./level-sync');

const asMember = JSON.stringify([ROLE_GROUPS.member]);
const asTrial = JSON.stringify([]);

beforeEach(() => {
	vi.clearAllMocks();
	members.getXp.mockResolvedValue({ memberId: 'oc-1', xp: 0, level: 0 });
});

describe('syncing', () => {
	it('stores a genuine level 0, which is what makes null mean "never looked"', async () => {
		const u = await seedUser(db, { offcoinLevel: null, offcoinXp: null, groups: asMember });

		await syncOffcoinLevels(null);

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.offcoinLevel).toBe(0);
		expect(after.offcoinSyncedAt).not.toBeNull();
	});

	it('reports the previous cached level, so a change is visible', async () => {
		const u = await seedUser(db, { offcoinLevel: 1, groups: asMember });
		members.getXp.mockResolvedValue({ memberId: 'oc-1', xp: 500, level: 3 });

		const result = await syncOffcoinLevels(null);

		const row = result.members.find((m) => m.userId === u.id);
		expect(row).toMatchObject({ previousLevel: 1, level: 3 });
	});

	it('skips a member with no Puckstack link — there is no alias to ask about', async () => {
		const u = await seedUser(db, { puckstackUserId: null });

		const result = await syncOffcoinLevels(null);

		expect(result.skippedNoLink).toBeGreaterThan(0);
		expect(result.members.map((m) => m.userId)).not.toContain(u.id);
	});

	it('skips exited members, whose snapshot was cleared on the way out', async () => {
		const u = await seedUser(db, { membershipStatus: 'exited' });

		const result = await syncOffcoinLevels(null);

		expect(result.skippedExited).toBeGreaterThan(0);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.offcoinLevel).toBeNull();
	});

	it('records an unknown alias without failing the run', async () => {
		await seedUser(db, { email: 'ghost@example.com' });
		members.getXp.mockRejectedValue(new NotFound('no such member'));

		const result = await syncOffcoinLevels(null);

		expect(result.notFoundInOffcoin.map((r) => r.email)).toContain('ghost@example.com');
		expect(result.failed).toHaveLength(0);
	});

	it('keeps going when one member errors', async () => {
		const bad = await seedUser(db, { email: 'bad@example.com' });
		await seedUser(db, { email: 'good@example.com' });
		members.getXp.mockImplementation(async (alias: string) =>
			alias.includes(bad.puckstackUserId!)
				? Promise.reject(new Error('offcoin down'))
				: { memberId: 'oc-1', xp: 10, level: 1 }
		);

		const result = await syncOffcoinLevels(null);

		expect(result.failed.map((f) => f.email)).toContain('bad@example.com');
		expect(result.members.map((m) => m.email)).toContain('good@example.com');
	});
});

describe('the report', () => {
	it('flags a member sitting under the level that earns membership', async () => {
		// The question this run exists to answer.
		const u = await seedUser(db, { groups: asMember });
		members.getXp.mockResolvedValue({ memberId: 'oc-1', xp: 0, level: 0 });

		const result = await syncOffcoinLevels(null, true);

		expect(result.members.find((m) => m.userId === u.id)?.belowMemberLevel).toBe(true);
	});

	it('does not flag a trial member — they are not claiming membership', async () => {
		const u = await seedUser(db, { groups: asTrial });

		const result = await syncOffcoinLevels(null, true);

		expect(result.members.find((m) => m.userId === u.id)?.belowMemberLevel).toBe(false);
	});

	it('does not flag a member who has earned the level', async () => {
		const u = await seedUser(db, { groups: asMember });
		members.getXp.mockResolvedValue({
			memberId: 'oc-1',
			xp: 100,
			level: POLICY.levels.memberFromLevel
		});

		const result = await syncOffcoinLevels(null, true);

		expect(result.members.find((m) => m.userId === u.id)?.belowMemberLevel).toBe(false);
	});

	it('sorts lowest level first, since that is what is being looked for', async () => {
		const levels = new Map<string, number>();
		const a = await seedUser(db, { groups: asMember });
		const b = await seedUser(db, { groups: asMember });
		levels.set(a.puckstackUserId!, 4);
		levels.set(b.puckstackUserId!, 1);
		members.getXp.mockImplementation(async (alias: string) => {
			for (const [ps, level] of levels) if (alias.includes(ps)) return { xp: 0, level };
			return { xp: 0, level: 0 };
		});

		const result = await syncOffcoinLevels(null, true);
		const ordered = result.members.map((m) => m.level);
		expect([...ordered].sort((x, y) => x - y)).toEqual(ordered);
	});
});

describe('the dry run', () => {
	it('reads and reports without writing', async () => {
		const u = await seedUser(db, { offcoinLevel: null, groups: asMember });
		members.getXp.mockResolvedValue({ memberId: 'oc-1', xp: 250, level: 2 });

		const result = await syncOffcoinLevels(null, true);

		expect(result.members.find((m) => m.userId === u.id)?.level).toBe(2);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.offcoinLevel).toBeNull();
	});
});
