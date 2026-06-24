import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	getContributionProgress,
	userNeedsBuddyCall,
	VALID_CONTRIBUTION_IDS,
	type ContributionProgress
} from '$lib/server/contributions';

/**
 * GET /api/contributions/progress — returns the user's stored completion map
 * plus whether they still need to book a 1:1 buddy call.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const [progress, needsBuddyCall] = await Promise.all([
		getContributionProgress(locals.user.id),
		userNeedsBuddyCall(locals.user.id, locals.user.email)
	]);
	return json({ progress, needsBuddyCall });
};

/**
 * PATCH /api/contributions/progress — persist completed contribution item ids.
 * Body: { completedItems: Record<string, ISOstring>, reset?: boolean }.
 * Keys are validated against VALID_CONTRIBUTION_IDS; merge-union with existing
 * (never removes) unless reset=true. Mirrors /api/onboarding/progress.
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const body = await request.json();
	const { completedItems, reset } = body as {
		completedItems: ContributionProgress;
		reset?: boolean;
	};

	if (!completedItems || typeof completedItems !== 'object') {
		error(400, 'Invalid payload: completedItems must be an object');
	}

	const validIds = new Set<string>(VALID_CONTRIBUTION_IDS);
	const sanitized: ContributionProgress = {};
	for (const [key, value] of Object.entries(completedItems)) {
		if (validIds.has(key) && typeof value === 'string') {
			sanitized[key] = value;
		}
	}

	let merged: ContributionProgress;
	if (reset) {
		merged = sanitized;
	} else {
		const existing = await getContributionProgress(locals.user.id);
		merged = { ...existing, ...sanitized };
	}

	await db
		.update(user)
		.set({ contributionProgress: JSON.stringify(merged), updatedAt: new Date() })
		.where(eq(user.id, locals.user.id));

	return json({ success: true, progress: merged });
};
