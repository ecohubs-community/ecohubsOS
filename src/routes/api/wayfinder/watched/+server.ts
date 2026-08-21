import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markVideoWatched } from '$lib/server/wayfinder';
import { rewardVideoWatch } from '$lib/server/wayfinder-rewards';
import { findWayfinderVideo } from '$lib/wayfinder/videos';
import { onboardingLogger } from '$lib/server/logger';

/**
 * POST /api/wayfinder/watched  { videoId }
 * Marks one Wayfinder video as finished for the current member. Idempotent —
 * the first watch wins, so re-watching never moves the timestamp.
 *
 * Responds with `reward` only when ECO and XP were actually paid *by this
 * request*, which is what the client turns into a toast. A re-watch, a member
 * who has not connected Offcoin, or a payout that failed all come back with
 * `reward: null` — the watch itself still stands either way, because losing
 * someone's progress over a payment problem would be the worse failure.
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

	const outcome = await rewardVideoWatch(locals.user.id, videoId);

	onboardingLogger.info(
		{ userId: locals.user.id, userName: locals.user.name, videoId, reward: outcome.status },
		`User watched Wayfinder video "${video.title}"`
	);

	return json({
		success: true,
		videoId,
		watchedAt,
		reward: outcome.status === 'granted' ? outcome.reward : null
	});
};
