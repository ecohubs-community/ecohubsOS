/**
 * Trial → Member promotion, the one automatic role change in the system.
 *
 * It used to live inside the Offcoin webhook, so it only ran when an XP event
 * arrived *and* crossed the threshold. Anyone whose crossing event predated the
 * webhook, or was dropped by the old alias bug, sat at level 1+ as a trial
 * member indefinitely — the OS read their real level several times a day and
 * never acted on it. Every place that learns a level now calls this.
 *
 * Promotion only grants rights, which is why it may run unattended. Every
 * downgrade waits for a human.
 */

import { db } from '$lib/server/db';
import { user as userTable, membershipEvents } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { POLICY, ROLE_GROUPS, parseGroupsJson, resolveRole } from '$lib/policy';
import {
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	addUserToAuthentikGroup
} from '$lib/server/authentik';
import { offcoinLogger } from '$lib/server/logger';

export type PromotionOutcome =
	| { kind: 'promoted' }
	/** Under the level, not active, already a member, or no such user. */
	| { kind: 'not_eligible' }
	| { kind: 'failed'; error: string };

/**
 * Whether a member with these figures should be promoted. Pure, so the level
 * sync's dry run can report who *would* be promoted without touching Authentik.
 */
export function isEligibleForPromotion(
	u: Pick<typeof userTable.$inferSelect, 'groups' | 'membershipStatus'>,
	level: number
): boolean {
	if (level < POLICY.levels.memberFromLevel) return false;
	if (u.membershipStatus !== 'active') return false;
	return resolveRole(parseGroupsJson(u.groups)) === 'trial';
}

/**
 * Grant the Member group if `level` earns it.
 *
 * Reads the user row fresh rather than trusting the caller's copy, so a stale
 * `locals.user` or a redelivered webhook cannot double-apply. Idempotent: it
 * checks the group already held, not a previous level.
 *
 * Never throws. Every caller is serving a request that has already succeeded
 * (or is a sweep that must keep going), and a failed promotion is retried by
 * the next level read anyway.
 */
export async function promoteIfEligible(userId: string, level: number): Promise<PromotionOutcome> {
	try {
		const dbUser = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
		if (!dbUser || !isEligibleForPromotion(dbUser, level)) return { kind: 'not_eligible' };

		const groupUuid = await getAuthentikGroupByName(ROLE_GROUPS.member);
		if (!groupUuid) {
			offcoinLogger.error({ group: ROLE_GROUPS.member }, 'Member group missing — cannot promote');
			return { kind: 'failed', error: 'Member group not found in Authentik' };
		}

		const authentikUserPk = await getAuthentikUserByEmail(dbUser.email);
		if (authentikUserPk === null) {
			offcoinLogger.error({ userId }, 'No Authentik user — cannot promote');
			return { kind: 'failed', error: 'No Authentik user for this email' };
		}

		await addUserToAuthentikGroup(groupUuid, authentikUserPk);

		// Mirror locally so the new rights apply before their next OIDC login.
		const groups = parseGroupsJson(dbUser.groups);
		const nextGroups = [...groups, ROLE_GROUPS.member];
		await db
			.update(userTable)
			.set({ groups: JSON.stringify(nextGroups), updatedAt: new Date() })
			.where(eq(userTable.id, userId));

		await db.insert(membershipEvents).values({
			userId,
			fromRole: resolveRole(groups),
			toRole: resolveRole(nextGroups),
			reason: `Reached Offcoin Level ${level}`,
			actorUserId: null // system-applied
		});

		offcoinLogger.info({ userId, level }, 'Promoted to Member');
		return { kind: 'promoted' };
	} catch (err) {
		offcoinLogger.error({ err, userId }, 'Promotion failed');
		return { kind: 'failed', error: err instanceof Error ? err.message : 'Unknown error' };
	}
}
