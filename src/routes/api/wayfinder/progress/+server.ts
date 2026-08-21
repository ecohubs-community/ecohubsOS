import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWatchedVideos } from '$lib/server/wayfinder';

/**
 * GET /api/wayfinder/progress
 * Which Wayfinder videos the current member has finished. The catalogue itself
 * ships to the client in the bundle, so this returns only the watch record.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const watched = await getWatchedVideos(locals.user.id, locals.user.introWatchedAt ?? null);
	return json({ watched });
};
