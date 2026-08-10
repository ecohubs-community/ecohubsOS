/**
 * Seeding participation from session history.
 *
 * The point of this backfill is that a null timestamp makes the review
 * evaluator silent forever for anyone who never returns, so these cover what it
 * seeds, what it refuses to invent, and that a real signal always outranks a
 * reconstructed one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const { backfillParticipation } = await import('./participation-backfill');

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let seq = 0;
async function addSession(userId: string, at: Date) {
	seq++;
	await db.insert(schema.session).values({
		id: `s${seq}`,
		userId,
		token: `t${seq}`,
		expiresAt: new Date(Date.now() + DAY),
		createdAt: at,
		updatedAt: at
	});
}

beforeEach(() => vi.clearAllMocks());

describe('seeding from sessions', () => {
	it('dates a member from their most recent sign-in, not their first', async () => {
		const u = await seedUser(db, { lastParticipationAt: null });
		await addSession(u.id, daysAgo(300));
		await addSession(u.id, daysAgo(120));

		const result = await backfillParticipation(null);

		expect(result.seeded).toBe(1);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(Math.round((Date.now() - after.lastParticipationAt!.getTime()) / DAY)).toBe(120);
		expect(after.lastParticipationSource).toBe('login');
	});

	it('leaves a member who already has a timestamp alone', async () => {
		// Theirs may be a stronger signal than a login — a vote, a task, a grant.
		const existing = daysAgo(10);
		const u = await seedUser(db, { lastParticipationAt: existing });
		await addSession(u.id, daysAgo(200));

		const result = await backfillParticipation(null);

		expect(result.alreadyRecorded).toBeGreaterThan(0);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		// Stored as epoch seconds, so compare at second precision.
		expect(Math.floor(after.lastParticipationAt!.getTime() / 1000)).toBe(
			Math.floor(existing.getTime() / 1000)
		);
	});

	it('invents no date for someone who has never signed in', async () => {
		// Starting a clock against an account the system has never seen would be
		// the same mistake as reading null as "inactive since forever".
		const u = await seedUser(db, { lastParticipationAt: null });

		const result = await backfillParticipation(null);

		expect(result.skippedNoSession).toBeGreaterThan(0);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.lastParticipationAt).toBeNull();
	});

	it('skips exited members, whose clock is over', async () => {
		const u = await seedUser(db, { lastParticipationAt: null, membershipStatus: 'exited' });
		await addSession(u.id, daysAgo(50));

		const result = await backfillParticipation(null);

		expect(result.skippedExited).toBeGreaterThan(0);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.lastParticipationAt).toBeNull();
	});
});

describe('the dry run', () => {
	it('reports what it would do and writes nothing', async () => {
		const u = await seedUser(db, { lastParticipationAt: null });
		await addSession(u.id, daysAgo(90));

		const result = await backfillParticipation(null, true);

		expect(result.seeded).toBe(1);
		expect(result.seededMembers.map((m) => m.userId)).toContain(u.id);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.lastParticipationAt).toBeNull();
	});

	it('names who it would seed and to when, so the effect can be judged first', async () => {
		const u = await seedUser(db, { lastParticipationAt: null, name: 'Idle Member' });
		await addSession(u.id, daysAgo(200));

		const result = await backfillParticipation(null, true);

		const entry = result.seededMembers.find((m) => m.userId === u.id);
		expect(entry?.name).toBe('Idle Member');
		expect(entry?.lastLoginAt).toBeTruthy();
	});
});

describe('re-running', () => {
	it('is idempotent — the second pass has nothing left to seed', async () => {
		const u = await seedUser(db, { lastParticipationAt: null });
		await addSession(u.id, daysAgo(60));

		const first = await backfillParticipation(null);
		const second = await backfillParticipation(null);

		// Assert on this member, not on a total: the fixture database is shared
		// across the file, so other tests' users are in the same run.
		expect(first.seededMembers.map((m) => m.userId)).toContain(u.id);
		expect(second.seededMembers.map((m) => m.userId)).not.toContain(u.id);
	});
});

describe('a concurrent write during the run', () => {
	it('does not report a seed that the guard actually blocked', async () => {
		// The race: the row is read with no timestamp, and a real signal lands
		// before the UPDATE. The forward-only guard then matches nothing — and a
		// zero-row UPDATE does not throw, so without checking what was written this
		// would report work it never did.
		//
		// Simulated by handing the function a stale read of a row that already
		// holds a newer timestamp, which is precisely the state the race produces.
		const u = await seedUser(db, { lastParticipationAt: daysAgo(1) });
		await addSession(u.id, daysAgo(200));

		const rows = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		const stale = { ...rows[0], lastParticipationAt: null };

		const realSelect = db.select.bind(db);
		const spy = vi
			.spyOn(db, 'select')
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.mockImplementationOnce((() => ({ from: async () => [stale] })) as any);

		let result;
		try {
			result = await backfillParticipation(null);
		} finally {
			spy.mockRestore();
			void realSelect;
		}

		expect(result.seededMembers.map((m) => m.userId)).not.toContain(u.id);
		expect(result.alreadyRecorded).toBeGreaterThan(0);

		// And the real timestamp is untouched — the point of the guard.
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(Math.round((Date.now() - after.lastParticipationAt!.getTime()) / DAY)).toBe(1);
	});
});
