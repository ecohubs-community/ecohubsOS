import { db } from '$lib/server/db';
import { user, memberOnboarding } from '$lib/server/db/schema';
import { eq, or } from 'drizzle-orm';

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

/**
 * Whether the member still needs a 1:1 buddy call — i.e. they have an
 * onboarding row but the call has neither been held (`buddyCallAt`) nor
 * deliberately skipped (`buddyCallSkippedAt`). Members without an onboarding
 * row (founders / pre-onboarding-system accounts) are not nudged. Drives the
 * "Book your 1:1 Buddy call" item in the Immediate Contributions card.
 */
export async function userNeedsBuddyCall(userId: string, email: string): Promise<boolean> {
	const row = await db.query.memberOnboarding.findFirst({
		where: or(eq(memberOnboarding.userId, userId), eq(memberOnboarding.email, email))
	});
	if (!row) return false;
	return !row.buddyCallAt && !row.buddyCallSkippedAt;
}
