import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOnboardingProgress } from '$lib/server/onboarding';
import { createDefaultSteps } from '$lib/onboarding/stepManager';
import { onboardingLogger } from '$lib/server/logger';

/**
 * Substep ids the *current* default flow actually has the user complete.
 * Derived from createDefaultSteps() so this stays in sync with the flow
 * — `VALID_SUBSTEP_IDS` from server/onboarding.ts is a wider whitelist
 * that also accepts retired substep ids for backwards-compat validation
 * of stored progress JSON, which is the wrong list for completion gate.
 */
function requiredSubstepIds(): string[] {
	const ids: string[] = [];
	for (const step of createDefaultSteps()) {
		for (const sub of step.subSteps ?? []) {
			ids.push(sub.id);
		}
	}
	return ids;
}

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

	// Verify all current default-flow substeps are completed server-side.
	const progress = await getOnboardingProgress(locals.user.id);
	const missingSteps = requiredSubstepIds().filter((id) => !progress[id]);

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
