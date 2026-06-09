import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { onboardingLogger } from '$lib/server/logger';

/**
 * POST /api/intro/watched
 * Marks the welcome/intro video as watched for the current user. Idempotent —
 * the timestamp is only set the first time, so re-watches don't move it.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	if (locals.user.introWatchedAt) {
		return json({ success: true, introWatchedAt: locals.user.introWatchedAt.toISOString() });
	}

	const now = new Date();
	await db
		.update(user)
		.set({ introWatchedAt: now, updatedAt: now })
		.where(eq(user.id, locals.user.id));

	onboardingLogger.info(
		{ userId: locals.user.id, userName: locals.user.name },
		'User watched the welcome/intro video'
	);

	return json({ success: true, introWatchedAt: now.toISOString() });
};
