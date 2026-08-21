import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markVideoWatched } from '$lib/server/wayfinder';
import { findWayfinderVideo } from '$lib/wayfinder/videos';
import { onboardingLogger } from '$lib/server/logger';

/**
 * POST /api/wayfinder/watched  { videoId }
 * Marks one Wayfinder video as finished for the current member. Idempotent —
 * the first watch wins, so re-watching never moves the timestamp.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => ({}));
	const videoId = typeof body?.videoId === 'string' ? body.videoId : '';
	const video = findWayfinderVideo(videoId);
	if (!video) {
		error(400, 'Unknown video');
	}

	const watchedAt = await markVideoWatched(
		locals.user.id,
		videoId,
		locals.user.introWatchedAt ?? null
	);

	onboardingLogger.info(
		{ userId: locals.user.id, userName: locals.user.name, videoId },
		`User watched Wayfinder video "${video.title}"`
	);

	return json({ success: true, videoId, watchedAt });
};
