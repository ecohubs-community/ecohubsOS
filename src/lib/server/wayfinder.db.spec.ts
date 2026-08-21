/**
 * Wayfinder watch tracking against a real database.
 *
 * What needs a database here is the idempotency and the legacy fold: a member's
 * learning-path percentage is only trustworthy if a re-watch cannot add a
 * second row, and if the welcome video someone watched before Wayfinder existed
 * still counts without a backfill migration.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const { getWatchedVideos, markVideoWatched } = await import('./wayfinder');
const { WELCOME_VIDEO_ID } = await import('$lib/wayfinder/videos');

/** Watch rows belonging to one member. */
function rowsFor(userId: string) {
	return db
		.select()
		.from(schema.wayfinderWatches)
		.where(eq(schema.wayfinderWatches.userId, userId));
}

describe('marking a video watched', () => {
	it('records it once, however many times it is reported', async () => {
		const member = await seedUser(db);

		const first = await markVideoWatched(member.id, 'voting', null);
		const second = await markVideoWatched(member.id, 'voting', null);

		// The second call must not move the timestamp — the learning path counts
		// rows, so a re-watch that re-stamped would let progress drift.
		expect(second).toBe(first);
		expect(await rowsFor(member.id)).toHaveLength(1);
	});

	it('keeps each member’s progress to themselves', async () => {
		const a = await seedUser(db);
		const b = await seedUser(db);

		await markVideoWatched(a.id, 'desktop-intro', null);

		expect(await rowsFor(a.id)).toHaveLength(1);
		expect(await rowsFor(b.id)).toHaveLength(0);
	});

	it('refuses a video that is not in the catalogue', async () => {
		const member = await seedUser(db);

		await expect(markVideoWatched(member.id, 'not-a-video', null)).rejects.toThrow(
			/Unknown Wayfinder video/
		);
		expect(await rowsFor(member.id)).toHaveLength(0);
	});

	it('mirrors the welcome video onto the legacy user flag', async () => {
		const member = await seedUser(db);

		await markVideoWatched(member.id, WELCOME_VIDEO_ID, null);

		// The dock pin, the auto-open and the Members app all still read this
		// column, so the welcome video has to land in both places.
		const [row] = await db.select().from(schema.user).where(eq(schema.user.id, member.id));
		expect(row.introWatchedAt).toBeInstanceOf(Date);
	});

	it('leaves the legacy flag alone for every other video', async () => {
		const member = await seedUser(db);

		await markVideoWatched(member.id, 'voting', null);

		const [row] = await db.select().from(schema.user).where(eq(schema.user.id, member.id));
		expect(row.introWatchedAt).toBeNull();
	});
});

describe('reading back progress', () => {
	it('returns what the member has actually watched', async () => {
		const member = await seedUser(db);
		await markVideoWatched(member.id, 'voting', null);
		await markVideoWatched(member.id, 'desktop-intro', null);

		const watched = await getWatchedVideos(member.id, null);

		expect(watched.map((w) => w.videoId).sort()).toEqual(['desktop-intro', 'voting']);
	});

	it('credits the welcome video to members who watched it before Wayfinder', async () => {
		// No watch row at all — only the old column. This is the whole reason
		// there is no backfill migration.
		const legacyWatchedAt = new Date('2026-02-01T10:00:00.000Z');
		const member = await seedUser(db, { introWatchedAt: legacyWatchedAt });

		const watched = await getWatchedVideos(member.id, legacyWatchedAt);

		expect(watched).toEqual([
			{ videoId: WELCOME_VIDEO_ID, watchedAt: legacyWatchedAt.toISOString() }
		]);
	});

	it('prefers the real watch row over the legacy flag', async () => {
		const legacyWatchedAt = new Date('2026-02-01T10:00:00.000Z');
		const member = await seedUser(db, { introWatchedAt: legacyWatchedAt });
		await markVideoWatched(member.id, WELCOME_VIDEO_ID, legacyWatchedAt);

		const watched = await getWatchedVideos(member.id, legacyWatchedAt);

		// One entry, not two — the fold must not double-count the welcome video.
		expect(watched).toHaveLength(1);
		expect(watched[0].watchedAt).not.toBe(legacyWatchedAt.toISOString());
	});
});
