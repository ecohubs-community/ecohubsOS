import { db } from '$lib/server/db';
import { user, wayfinderWatches } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { WELCOME_VIDEO_ID, findWayfinderVideo } from '$lib/wayfinder/videos';

export interface WayfinderWatch {
	videoId: string;
	watchedAt: string;
}

/**
 * Everything this member has finished, as `videoId -> ISO timestamp`.
 *
 * Reads the `wayfinder_watches` rows and folds in the legacy
 * `user.introWatchedAt` as an implicit watch of the welcome video, so members
 * who watched the intro before Wayfinder existed are not asked to sit through
 * it again. That fold is why there is no backfill migration.
 */
export async function getWatchedVideos(
	userId: string,
	introWatchedAt: Date | null
): Promise<WayfinderWatch[]> {
	const rows = await db
		.select({ videoId: wayfinderWatches.videoId, watchedAt: wayfinderWatches.watchedAt })
		.from(wayfinderWatches)
		.where(eq(wayfinderWatches.userId, userId));

	const watched = new Map<string, string>(
		rows.map((r) => [r.videoId, r.watchedAt.toISOString()] as const)
	);

	if (introWatchedAt && !watched.has(WELCOME_VIDEO_ID)) {
		watched.set(WELCOME_VIDEO_ID, introWatchedAt.toISOString());
	}

	return [...watched].map(([videoId, watchedAt]) => ({ videoId, watchedAt }));
}

/**
 * Record that this member finished a video. Idempotent — the first watch wins,
 * so a re-watch never moves the timestamp. Returns the effective timestamp.
 *
 * Throws if `videoId` is not in the catalogue; the caller should turn that into
 * a 400 rather than storing a key nothing can ever render.
 */
export async function markVideoWatched(
	userId: string,
	videoId: string,
	introWatchedAt: Date | null
): Promise<string> {
	if (!findWayfinderVideo(videoId)) {
		throw new Error(`Unknown Wayfinder video: ${videoId}`);
	}

	const now = new Date();

	// The unique index on (user_id, video_id) is what makes this idempotent
	// under concurrent posts — two tabs finishing at once cannot double-insert.
	await db
		.insert(wayfinderWatches)
		.values({ userId, videoId, watchedAt: now })
		.onConflictDoNothing();

	// Mirror the welcome video onto the user row, which the dock pin, the
	// auto-open and the Members app all still read.
	//
	// `introWatchedAt` comes from the caller's session snapshot, which can be
	// stale — two requests can both read null and both try to write. The
	// `isNull` guard makes the database, not the snapshot, decide, so the
	// timestamp cannot be dragged forward off a first watch that already landed.
	if (videoId === WELCOME_VIDEO_ID && !introWatchedAt) {
		await db
			.update(user)
			.set({ introWatchedAt: now, updatedAt: now })
			.where(and(eq(user.id, userId), isNull(user.introWatchedAt)));
	}

	const [existing] = await db
		.select({ watchedAt: wayfinderWatches.watchedAt })
		.from(wayfinderWatches)
		.where(and(eq(wayfinderWatches.userId, userId), eq(wayfinderWatches.videoId, videoId)))
		.limit(1);

	return (existing?.watchedAt ?? now).toISOString();
}
