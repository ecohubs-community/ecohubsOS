import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOnboardingProgress, VALID_SUBSTEP_IDS } from '$lib/server/onboarding';
import { onboardingLogger } from '$lib/server/logger';

/**
 * POST /api/onboarding/complete
 * Marks onboarding as completed after verifying all substeps are done server-side.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	if (locals.user.onboardingCompletedAt) {
		return json({ success: true, message: 'Onboarding already completed' });
	}

	// Verify all substeps are completed server-side
	const progress = await getOnboardingProgress(locals.user.id);
	const missingSteps = VALID_SUBSTEP_IDS.filter((id) => !progress[id]);

	if (missingSteps.length > 0) {
		onboardingLogger.warn(
			{ userId: locals.user.id, missingSteps },
			'Attempted to complete onboarding with missing steps'
		);
		error(400, `Not all onboarding steps are completed. Missing: ${missingSteps.join(', ')}`);
	}

	// Set completion timestamp
	const now = new Date();
	await db
		.update(user)
		.set({ onboardingCompletedAt: now, updatedAt: now })
		.where(eq(user.id, locals.user.id));

	onboardingLogger.info(
		{ userId: locals.user.id, userName: locals.user.name },
		'User completed onboarding'
	);

	return json({ success: true });
};
