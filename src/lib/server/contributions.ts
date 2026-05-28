import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export type ContributionProgress = Record<string, string>;

/**
 * Contribution item ids that may be marked complete + persisted. Only the
 * static, markable items are listed — the dynamic Puckstack / voting /
 * profile items are link-only and resolve themselves, so they are never
 * persisted. Used as a write-validation whitelist (mirrors
 * onboarding.VALID_SUBSTEP_IDS).
 */
export const VALID_CONTRIBUTION_IDS = [
	'social-follow',
	'social-discord',
	'social-mastodon',
	'social-farcaster',
	'social-x',
	'social-youtube',
	'social-instagram',
	'social-linkedin',
	'social-github',
	'introduce-yourself',
	'add-calendar'
] as const;

/** Parse the user's stored contribution progress JSON (best-effort). */
export async function getContributionProgress(userId: string): Promise<ContributionProgress> {
	const dbUser = await db.query.user.findFirst({ where: eq(user.id, userId) });
	if (!dbUser?.contributionProgress) return {};
	try {
		const parsed = JSON.parse(dbUser.contributionProgress);
		return parsed && typeof parsed === 'object' ? (parsed as ContributionProgress) : {};
	} catch {
		return {};
	}
}
