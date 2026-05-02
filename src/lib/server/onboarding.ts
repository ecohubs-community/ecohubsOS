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
	'puckstack-signup',
	'discord-connect',
	'discord-introduce',
	'profile-setup'
] as const;
