import { db } from '$lib/server/db';
import { user, account } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { onboardingLogger } from '$lib/server/logger';

export type OnboardingProgress = Record<string, string>;

/**
 * Get merged onboarding progress for a user.
 * Combines stored JSON progress with auto-detected completions
 * from existing DB fields (wallet, Safe, Discord).
 */
export async function getOnboardingProgress(userId: string): Promise<OnboardingProgress> {
	const dbUser = await db.query.user.findFirst({
		where: eq(user.id, userId)
	});

	if (!dbUser) {
		onboardingLogger.warn({ userId }, 'User not found when fetching onboarding progress');
		return {};
	}

	// Parse stored progress JSON
	let progress: OnboardingProgress = {};
	if (dbUser.onboardingProgress) {
		try {
			progress = JSON.parse(dbUser.onboardingProgress);
		} catch {
			onboardingLogger.warn({ userId }, 'Failed to parse onboarding progress JSON');
		}
	}

	// Auto-detect: wallet-connect
	if (dbUser.walletAddress && !progress['wallet-connect']) {
		progress['wallet-connect'] =
			dbUser.walletConnectedAt?.toISOString() ?? new Date().toISOString();
	}

	// Auto-detect: safe-proposal
	if (dbUser.safeProposalTxHash && !progress['safe-proposal']) {
		progress['safe-proposal'] = new Date().toISOString();
	}

	// Auto-detect: discord-connect
	try {
		const discordAccount = await db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'discord'))
		});
		if (discordAccount && !progress['discord-connect']) {
			progress['discord-connect'] = discordAccount.createdAt.toISOString();
		}
	} catch (err) {
		onboardingLogger.warn({ err, userId }, 'Failed to check Discord account for auto-detection');
	}

	return progress;
}

/**
 * Substeps that retroactively apply to users who completed onboarding
 * before they were introduced. When a user has `onboardingCompletedAt`
 * set but is missing one of these in their progress JSON, the auth hook
 * sends them back to /onboarding so they can complete just the new step.
 *
 * Existing finished steps in their progress stay marked complete, so the
 * wizard's Finish button is one click away once the new step is done.
 */
export const RETROACTIVE_SUBSTEP_IDS = ['manifesto-sign'] as const;

/**
 * Parse a user's stored onboardingProgress JSON without hitting the DB.
 * Returns `{}` for null/empty/corrupt input — the caller is expected to
 * treat missing keys as "not yet completed".
 */
export function parseOnboardingProgress(json: string | null | undefined): OnboardingProgress {
	if (!json) return {};
	try {
		const parsed = JSON.parse(json);
		return parsed && typeof parsed === 'object' ? (parsed as OnboardingProgress) : {};
	} catch {
		return {};
	}
}

/**
 * True if the user has completed onboarding overall but is missing one
 * or more retroactive substeps and should be sent back to the wizard.
 */
export function hasPendingRetroactiveSteps(
	onboardingCompletedAt: Date | null,
	onboardingProgress: string | null
): boolean {
	if (!onboardingCompletedAt) return false;
	const progress = parseOnboardingProgress(onboardingProgress);
	return RETROACTIVE_SUBSTEP_IDS.some((id) => !progress[id]);
}

/** Whitelist of valid substep IDs for validation */
export const VALID_SUBSTEP_IDS = [
	// Retired substeps still appear here so already-stored progress JSON
	// validates cleanly during the transition. The default step list no
	// longer includes them — see stepManager.RETIRED_SUBSTEP_IDS.
	'wallet-setup',
	'wallet-connect',
	'safe-proposal',
	'snapshot-open',
	'snapshot-read',
	'snapshot-vote',
	'puckstack-copy-id',
	'offcoin-connect',
	'forum-login',
	'forum-read-latest',
	'forum-howto-create',
	'voting-open',
	'voting-read',
	'voting-vote',
	// Current substeps
	'manifesto-sign',
	'puckstack-signup',
	'discord-connect',
	'discord-introduce',
	'profile-setup'
] as const;
