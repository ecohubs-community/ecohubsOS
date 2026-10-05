import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { recordParticipation } from '$lib/server/participation';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	getOnboardingProgress,
	VALID_SUBSTEP_IDS,
	type OnboardingProgress
} from '$lib/server/onboarding';
import { onboardingLogger } from '$lib/server/logger';
import { SERVER_VERIFIED_SUBSTEP_IDS } from '$lib/onboarding/stepManager';

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

	// Validate and sanitize substep IDs against whitelist. Server-verified steps
	// (Discord) are dropped: only the server may say those happened.
	const validIds = new Set<string>(VALID_SUBSTEP_IDS);
	const serverOnly = new Set<string>(SERVER_VERIFIED_SUBSTEP_IDS);
	const sanitized: OnboardingProgress = {};
	for (const [key, value] of Object.entries(completedSteps)) {
		if (validIds.has(key) && !serverOnly.has(key) && typeof value === 'string') {
			sanitized[key] = value;
		}
	}

	const dbUser = await db.query.user.findFirst({
		where: eq(user.id, locals.user.id)
	});

	let existing: OnboardingProgress = {};
	if (dbUser?.onboardingProgress) {
		try {
			existing = JSON.parse(dbUser.onboardingProgress);
		} catch {
			onboardingLogger.warn(
				{ userId: locals.user.id },
				'Corrupt onboarding progress JSON in database, starting fresh merge'
			);
		}
	}

	let merged: OnboardingProgress;

	if (reset) {
		// Reset mode: replace client-reported progress with the provided entries,
		// but keep server-verified ones — the client could not have set them, so
		// it cannot clear them either.
		const kept = Object.fromEntries(Object.entries(existing).filter(([id]) => serverOnly.has(id)));
		merged = { ...kept, ...sanitized };
		onboardingLogger.info({ userId: locals.user.id }, 'Onboarding progress reset');
	} else {
		// Merge mode: union with existing (never remove entries)
		merged = { ...existing, ...sanitized };
	}

	await db
		.update(user)
		.set({
			onboardingProgress: JSON.stringify(merged),
			updatedAt: new Date()
		})
		.where(eq(user.id, locals.user.id));

	// Working through onboarding is participation — it is often the only thing a
	// brand-new member does before their first task.
	void recordParticipation(locals.user.id, 'onboarding');

	return json({ success: true, progress: merged });
};
