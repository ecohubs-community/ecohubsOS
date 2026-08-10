/**
 * The Offcoin snapshot cache.
 *
 * Level 0 is a real value in Offcoin — accounts start there — so the cache has
 * to distinguish "level 0" from "never looked", which is what null means. These
 * cover that the distinction survives a round trip, and that a bad reading
 * cannot poison a column the membership gates trust.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const { saveOffcoinSnapshot } = await import('./offcoin-snapshot');

const read = async (id: string) =>
	(await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];

describe('saveOffcoinSnapshot', () => {
	it('stores level 0 as a real reading, not as nothing', async () => {
		// The bug this exists to prevent: level 0 is where every Offcoin account
		// starts, so treating it as falsy would leave the cache null forever for
		// exactly the members whose level matters most.
		const u = await seedUser(db, { offcoinLevel: null, offcoinXp: null });

		await saveOffcoinSnapshot(u.id, { xp: 0, level: 0 });

		const after = await read(u.id);
		expect(after.offcoinLevel).toBe(0);
		expect(after.offcoinXp).toBe(0);
		expect(after.offcoinSyncedAt).not.toBeNull();
	});

	it('records the member id when one is supplied', async () => {
		const u = await seedUser(db);
		await saveOffcoinSnapshot(u.id, { memberId: 'oc-123', xp: 40, level: 2 });
		expect((await read(u.id)).offcoinMemberId).toBe('oc-123');
	});

	it('leaves a known member id alone when the caller has none', async () => {
		const u = await seedUser(db, { offcoinMemberId: 'oc-keep' });
		await saveOffcoinSnapshot(u.id, { xp: 10, level: 1 });
		expect((await read(u.id)).offcoinMemberId).toBe('oc-keep');
	});

	it('overwrites an older reading', async () => {
		const u = await seedUser(db, { offcoinLevel: 1, offcoinXp: 10 });
		await saveOffcoinSnapshot(u.id, { xp: 300, level: 4 });
		const after = await read(u.id);
		expect(after.offcoinLevel).toBe(4);
		expect(after.offcoinXp).toBe(300);
	});

	it('refuses a nonsense reading rather than caching it', async () => {
		// The gates read this column, so a NaN or negative would be worse than a
		// stale value — it would be a false statement about someone's standing.
		const u = await seedUser(db, { offcoinLevel: 3, offcoinXp: 200 });

		await saveOffcoinSnapshot(u.id, { xp: Number.NaN, level: Number.NaN });
		await saveOffcoinSnapshot(u.id, { xp: -5, level: -1 });

		const after = await read(u.id);
		expect(after.offcoinLevel).toBe(3);
		expect(after.offcoinXp).toBe(200);
	});

	it('never throws — a cache write must not fail the request it rode in on', async () => {
		await expect(saveOffcoinSnapshot('no-such-user', { xp: 1, level: 1 })).resolves.not.toThrow();
	});

	it('reports whether the write landed, so an admin sync can tell', async () => {
		// The request-path callers ignore this; the level sync counts on it, and
		// reporting a sync that never happened is the failure it exists to rule out.
		const u = await seedUser(db);
		expect(await saveOffcoinSnapshot(u.id, { xp: 5, level: 1 })).toBe(true);
		expect(await saveOffcoinSnapshot(u.id, { xp: Number.NaN, level: 1 })).toBe(false);
	});
});
