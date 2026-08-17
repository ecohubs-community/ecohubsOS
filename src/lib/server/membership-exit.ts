/**
 * Offboarding.
 *
 * `executeExit` is the one place a membership actually ends. It is deliberately
 * a single service rather than logic spread across the routes that trigger it,
 * because an exit has to reach four systems and a partial exit is worse than
 * none: someone locked out of the OS but still holding a Discord role and a
 * newsletter subscription looks, to them, like a bug rather than a decision.
 *
 * Every external step is best-effort and reported. The local status change is
 * the one that must succeed, and it goes first — the policy checks status
 * before role, so setting it is what actually denies access.
 */

import { db } from '$lib/server/db';
import {
	membershipEvents,
	session as sessionTable,
	user as userTable
} from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { ROLE_GROUPS, parseGroupsJson, resolveRole } from '$lib/policy';
import {
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	removeUserFromAuthentikGroup,
	setAuthentikUserActive
} from '$lib/server/authentik';
import { unsubscribeFromNewsletter } from '$lib/server/listmonk';
import { NotFoundError } from '@offcoin/sdk';
import { getOffcoinClient, withMemberAlias } from '$lib/server/offcoin';
import { removeDiscordMemberRole } from '$lib/server/discord';
import { apiLogger } from '$lib/server/logger';

export interface ExitResult {
	/** The local status change — the only step that must succeed. */
	statusSet: boolean;
	/** Per-system outcomes. False means "left in place", not "failed loudly". */
	authentikGroupsRemoved: boolean;
	authentikDeactivated: boolean;
	sessionsRevoked: number;
	newsletterUnsubscribed: boolean;
	discordRoleRemoved: boolean;
	/** True also when there was nothing to delete — the end state is what matters. */
	offcoinMemberDeleted: boolean;
	/** Anything that did not complete, for the caller to surface. */
	warnings: string[];
}

/**
 * End a membership.
 *
 * Idempotent: re-running on an already-exited member repeats the external
 * revocations, all of which treat "already gone" as success.
 *
 * @param reason - recorded on the audit trail; not shown to the member
 */
export async function executeExit(
	userId: string,
	reason: string,
	actorUserId: string | null
): Promise<ExitResult> {
	const result: ExitResult = {
		statusSet: false,
		authentikGroupsRemoved: false,
		authentikDeactivated: false,
		sessionsRevoked: 0,
		newsletterUnsubscribed: false,
		discordRoleRemoved: false,
		offcoinMemberDeleted: false,
		warnings: []
	};

	const member = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
	if (!member) {
		result.warnings.push('User not found');
		return result;
	}

	const previousGroups = parseGroupsJson(member.groups);
	const now = new Date();

	// 1. Status first. This is what denies access — everything below is cleanup
	//    of systems we do not control, and none of it should gate the decision.
	await db
		.update(userTable)
		.set({
			membershipStatus: 'exited',
			membershipStatusSince: now,
			exitReason: reason,
			// Drop them from the public roster immediately; the members endpoint
			// filters exited members anyway, but leaving this true would resurface
			// them if that filter were ever relaxed.
			showOnWebsite: false,
			groups: JSON.stringify([]),
			updatedAt: now
		})
		.where(eq(userTable.id, userId));
	result.statusSet = true;

	await db.insert(membershipEvents).values({
		userId,
		fromRole: resolveRole(previousGroups),
		toRole: 'trial',
		fromStatus: member.membershipStatus ?? 'active',
		toStatus: 'exited',
		reason,
		actorUserId
	});

	// 2. Revoke sessions so the exit takes effect without waiting for expiry.
	try {
		const revoked = await db
			.delete(sessionTable)
			.where(eq(sessionTable.userId, userId))
			.returning({ id: sessionTable.id });
		result.sessionsRevoked = revoked.length;
	} catch (err) {
		apiLogger.error({ err, userId }, 'Failed to revoke sessions on exit');
		result.warnings.push('Sessions could not be revoked');
	}

	// 3. Authentik: remove role groups, then deactivate. Group removal alone
	//    would leave them able to sign in as a trial member.
	try {
		const authentikUserPk = await getAuthentikUserByEmail(member.email);
		if (authentikUserPk === null) {
			result.warnings.push('No Authentik user found for this email');
		} else {
			for (const groupName of Object.values(ROLE_GROUPS)) {
				if (!previousGroups.includes(groupName)) continue;
				const uuid = await getAuthentikGroupByName(groupName);
				if (uuid) await removeUserFromAuthentikGroup(uuid, authentikUserPk);
			}
			result.authentikGroupsRemoved = true;

			await setAuthentikUserActive(authentikUserPk, false);
			result.authentikDeactivated = true;
		}
	} catch (err) {
		apiLogger.error({ err, userId }, 'Authentik revocation failed on exit');
		result.warnings.push(
			`Authentik access was not fully revoked: ${err instanceof Error ? err.message : 'unknown error'}`
		);
	}

	// 4. Newsletter.
	result.newsletterUnsubscribed = await unsubscribeFromNewsletter(member.email);
	if (!result.newsletterUnsubscribed) {
		result.warnings.push('Newsletter unsubscribe did not complete');
	}

	// 5. Discord. The Discord user id is not stored locally — it lives as a
	//    `discord:<id>` alias on the Offcoin member, added during the Discord
	//    OAuth callback. Look it up there.
	try {
		const discordUserId = await findDiscordUserId(member.puckstackUserId);
		if (discordUserId) {
			result.discordRoleRemoved = await removeDiscordMemberRole(discordUserId);
			if (!result.discordRoleRemoved) {
				result.warnings.push('Discord role removal did not complete');
			}
		}
	} catch (err) {
		apiLogger.error({ err, userId }, 'Discord role removal failed on exit');
		result.warnings.push('Discord role removal failed');
	}

	// 6. Offcoin, and it has to be last: step 5 reads the Discord id out of this
	//    member's aliases, so deleting it earlier would take the only record of
	//    which Discord account to strip.
	//
	//    Deleting rather than zeroing, because there is no `subtractXp` — and a
	//    surviving member is not merely untidy. Re-application is meant to be "a
	//    very new entry" at trial level, but the alias is derived from the
	//    Puckstack user id, so someone who re-applies and reconnects the same
	//    account resolves to their old member, and the level webhook promotes
	//    them past trial on arrival.
	if (member.puckstackUserId) {
		try {
			await withMemberAlias(member.puckstackUserId, (alias) =>
				getOffcoinClient().members.delete(alias)
			);
			result.offcoinMemberDeleted = true;
		} catch (err) {
			// Already gone is the outcome we wanted.
			if (err instanceof NotFoundError) {
				result.offcoinMemberDeleted = true;
			} else {
				apiLogger.error({ err, userId }, 'Offcoin member deletion failed on exit');
				result.warnings.push(
					'Offcoin balance not cleared — re-application would resume the old level'
				);
			}
		}
	} else {
		// Never connected Offcoin, so there is nothing to delete and the end state
		// is already the one we want. Reporting false here would read as unfinished
		// cleanup for a member who never had an Offcoin record.
		result.offcoinMemberDeleted = true;
	}

	// Drop the local snapshot whichever way that went. It describes a member that
	// should no longer exist, and `can()` reads `offcoinLevel` — leaving it set
	// would let a returning trial member be gated as though they still held the
	// level they left with.
	await db
		.update(userTable)
		.set({
			offcoinMemberId: null,
			offcoinXp: null,
			offcoinLevel: null,
			offcoinSyncedAt: null,
			updatedAt: new Date()
		})
		.where(eq(userTable.id, userId));

	apiLogger.info({ userId, actorUserId, warnings: result.warnings.length }, 'Membership exited');
	return result;
}

/** Read the Discord user id back out of the member's Offcoin aliases. */
async function findDiscordUserId(puckstackUserId: string | null): Promise<string | null> {
	if (!puckstackUserId) return null;
	const member = await withMemberAlias(puckstackUserId, (a) => getOffcoinClient().members.get(a));
	const alias = (member.aliases ?? []).find((a: string) => a.startsWith('discord:'));
	return alias ? alias.slice('discord:'.length) : null;
}
