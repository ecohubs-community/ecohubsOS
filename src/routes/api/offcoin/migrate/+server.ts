import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { offcoinLogger } from '$lib/server/logger';

/**
 * Migrate puckstackUserId from localStorage to server DB.
 *
 * One-time migration for existing users who connected Offcoin
 * before server-side persistence was added. Skips if user already
 * has a puckstackUserId stored in the DB.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { puckstackUserId } = await request.json();

	if (!puckstackUserId || typeof puckstackUserId !== 'string') {
		error(400, 'puckstackUserId is required');
	}

	// Skip if already persisted (idempotent)
	if (locals.user.puckstackUserId) {
		return json({ success: true, migrated: false });
	}

	try {
		await db
			.update(user)
			.set({
				puckstackUserId,
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));

		offcoinLogger.info(
			{ userId: locals.user.id, puckstackUserId },
			'Migrated puckstackUserId from localStorage to DB'
		);

		return json({ success: true, migrated: true });
	} catch (err) {
		offcoinLogger.error(
			{ err, userId: locals.user.id, puckstackUserId },
			'Failed to migrate puckstackUserId to DB'
		);
		error(500, 'Migration failed');
	}
};
