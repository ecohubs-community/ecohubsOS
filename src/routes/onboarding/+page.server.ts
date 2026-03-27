import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOnboardingProgress, VALID_SUBSTEP_IDS } from '$lib/server/onboarding';
import { onboardingLogger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(303, '/login');
	}

	if (locals.user.onboardingCompletedAt) {
		redirect(303, '/');
	}

	// Fetch server-side onboarding progress (stored + auto-detected)
	const onboardingProgress = await getOnboardingProgress(locals.user.id);

	// Auto-migration: if all substeps are already complete, mark onboarding as done
	const allComplete = VALID_SUBSTEP_IDS.every((id) => !!onboardingProgress[id]);
	if (allComplete) {
		const now = new Date();
		await db
			.update(userTable)
			.set({
				onboardingCompletedAt: now,
				onboardingStartedAt: locals.user.onboardingStartedAt ?? now,
				updatedAt: now
			})
			.where(eq(userTable.id, locals.user.id));

		onboardingLogger.info(
			{ userId: locals.user.id, userName: locals.user.name },
			'User auto-migrated: all onboarding steps already complete'
		);

		redirect(303, '/');
	}

	// Set onboardingStartedAt if this is the first visit
	if (!locals.user.onboardingStartedAt) {
		const now = new Date();
		await db
			.update(userTable)
			.set({ onboardingStartedAt: now, updatedAt: now })
			.where(eq(userTable.id, locals.user.id));

		onboardingLogger.info(
			{ userId: locals.user.id, userName: locals.user.name },
			'User started onboarding'
		);
	}

	// Parse JSON fields for client (same shape as desktop +page.server.ts)
	const safeJsonParse = <T,>(json: string | null | undefined, fallback: T): T => {
		if (!json) return fallback;
		try {
			return JSON.parse(json) as T;
		} catch {
			return fallback;
		}
	};

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
			displayName: locals.user.displayName,
			avatar: locals.user.avatar,
			bio: locals.user.bio,
			languages: locals.user.languages,
			location: locals.user.location,
			contribution: locals.user.contribution,
			showOnWebsite: locals.user.showOnWebsite ?? true,
			safeOwnerStatus: locals.user.safeOwnerStatus,
			safeRole: locals.user.safeRole,
			safeRoleStatus: locals.user.safeRoleStatus,
			puckstackUserId: locals.user.puckstackUserId
		},
		onboardingProgress
	};
};
