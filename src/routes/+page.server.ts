import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authLogger } from '$lib/server/logger';
import { getOnboardingProgress } from '$lib/server/onboarding';

/**
 * Safely parse JSON with fallback to default value
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch (err) {
		authLogger.warn({ err, json }, 'Failed to parse JSON field');
		return fallback;
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	// Redirect to login if not authenticated
	if (!locals.user) {
		redirect(303, '/login');
	}

	// Fetch onboarding progress (stored + auto-detected from wallet/safe/discord)
	const onboardingProgress = await getOnboardingProgress(locals.user.id);

	// Parse JSON fields for client with safe fallbacks
	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			emailVerified: locals.user.emailVerified,
			image: locals.user.image,
			groups: safeJsonParse<string[]>(locals.user.groups, []),
			roles: safeJsonParse<string[]>(locals.user.roles, []),
			walletAddress: locals.user.walletAddress,
			safeOwnerStatus: locals.user.safeOwnerStatus
		},
		onboardingProgress
	};
};
