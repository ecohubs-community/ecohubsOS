import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	getOnboardingProgress,
	VALID_SUBSTEP_IDS,
	type OnboardingProgress
} from '$lib/server/onboarding';
import { onboardingLogger } from '$lib/server/logger';

/**
 * GET /api/onboarding/progress
 * Returns merged onboarding progress (stored + auto-detected)
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const progress = await getOnboardingProgress(locals.user.id);
	return json({ progress });
};

/**
 * PATCH /api/onboarding/progress
 * Persists completed substep IDs to the server.
 * Merges with existing progress (union) unless reset=true.
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = await request.json();
	const { completedSteps, reset } = body as {
		completedSteps: OnboardingProgress;
		reset?: boolean;
	};

	if (!completedSteps || typeof completedSteps !== 'object') {
		error(400, 'Invalid payload: completedSteps must be an object');
	}

	// Validate and sanitize substep IDs against whitelist
	const validIds = new Set<string>(VALID_SUBSTEP_IDS);
	const sanitized: OnboardingProgress = {};
	for (const [key, value] of Object.entries(completedSteps)) {
		if (validIds.has(key) && typeof value === 'string') {
			sanitized[key] = value;
		}
	}

	let merged: OnboardingProgress;

	if (reset) {
		// Reset mode: replace all progress with the provided (sanitized) entries
		merged = sanitized;
		onboardingLogger.info({ userId: locals.user.id }, 'Onboarding progress reset');
	} else {
		// Merge mode: union with existing (never remove entries)
		const dbUser = await db.query.user.findFirst({
			where: eq(user.id, locals.user.id)
		});

		let existing: OnboardingProgress = {};
		if (dbUser?.onboardingProgress) {
			try {
				existing = JSON.parse(dbUser.onboardingProgress);
			} catch {
				// ignore corrupt data
			}
		}

		merged = { ...existing, ...sanitized };
	}

	await db
		.update(user)
		.set({
			onboardingProgress: JSON.stringify(merged),
			updatedAt: new Date()
		})
		.where(eq(user.id, locals.user.id));

	return json({ success: true, progress: merged });
};
