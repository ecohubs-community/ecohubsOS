/**
 * Granting and revoking the Authentik groups an admin is allowed to manage.
 *
 * Generalises the steward toggle so the requestable tools — blog, newsletter,
 * blueprint, social — can be handed out the same way, without opening a
 * general-purpose "write any group" endpoint. The allowlist is the point: an
 * arbitrary group name reaching Authentik would let this become a way to grant
 * anything the identity provider knows about.
 *
 * Authentik is the source of truth, but its group claim only refreshes on the
 * member's next OIDC login, so each change is mirrored into the local
 * `user.groups` JSON for immediate effect.
 */

import { db } from '$lib/server/db';
import { membershipEvents, user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { GRANT_GROUPS, ROLE_GROUPS, parseGroupsJson, resolveRole } from '$lib/policy';
import {
	addUserToAuthentikGroup,
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	removeUserFromAuthentikGroup
} from '$lib/server/authentik';
import { apiLogger } from '$lib/server/logger';

/**
 * The groups an admin may toggle, with member-facing labels.
 *
 * `EcoHubs Admin` is deliberately absent. Admin is granted out-of-band on
 * purpose: an endpoint that can mint admins is an endpoint that can hand over
 * the whole community, and the safeguards that would need are not worth
 * building for something that happens a handful of times.
 *
 * `EcoHubs Member` is absent too — it is granted by the Offcoin level-up
 * webhook and removed by an exit, so hand-editing it would fight the automation.
 */
export const MANAGEABLE_GROUPS: Record<string, { label: string; kind: 'role' | 'grant' }> = {
	[ROLE_GROUPS.steward]: { label: 'Steward', kind: 'role' },
	[GRANT_GROUPS.blog]: { label: 'Blog', kind: 'grant' },
	[GRANT_GROUPS.newsletter]: { label: 'Newsletter', kind: 'grant' },
	[GRANT_GROUPS.blueprint]: { label: 'Blueprint', kind: 'grant' },
	[GRANT_GROUPS.social]: { label: 'Social', kind: 'grant' }
};

export function isManageableGroup(group: string): boolean {
	return Object.prototype.hasOwnProperty.call(MANAGEABLE_GROUPS, group);
}

export interface GroupChangeResult {
	ok: boolean;
	error?: string;
	groups?: string[];
}

/**
 * Add or remove one allowlisted group for a member.
 *
 * Authentik is updated first: if that fails there is nothing to roll back, and
 * a local mirror that claims a group the identity provider does not grant would
 * be worse than an error.
 */
export async function setGroupMembership(input: {
	userId: string;
	group: string;
	action: 'add' | 'remove';
	actorUserId: string;
}): Promise<GroupChangeResult> {
	if (!isManageableGroup(input.group)) {
		return { ok: false, error: 'That group cannot be managed from here' };
	}

	const target = await db.query.user.findFirst({ where: eq(userTable.id, input.userId) });
	if (!target) return { ok: false, error: 'Member not found' };

	const groups = parseGroupsJson(target.groups);
	const holds = groups.includes(input.group);

	// Already in the desired state — report success rather than churning
	// Authentik, so a double-click is harmless.
	if ((input.action === 'add' && holds) || (input.action === 'remove' && !holds)) {
		return { ok: true, groups };
	}

	// Removing your own steward role is the one self-inflicted change worth
	// blocking: it takes away the app you are standing in, and the recovery path
	// is asking someone else to put it back.
	if (
		input.action === 'remove' &&
		input.group === ROLE_GROUPS.steward &&
		input.userId === input.actorUserId
	) {
		return { ok: false, error: 'Ask another admin to remove your own steward role' };
	}

	try {
		const groupUuid = await getAuthentikGroupByName(input.group);
		if (!groupUuid) {
			return { ok: false, error: `Authentik group "${input.group}" not found` };
		}

		const authentikUserPk = await getAuthentikUserByEmail(target.email);
		if (authentikUserPk === null) {
			return { ok: false, error: `No Authentik user for ${target.email}` };
		}

		if (input.action === 'add') {
			await addUserToAuthentikGroup(groupUuid, authentikUserPk);
		} else {
			await removeUserFromAuthentikGroup(groupUuid, authentikUserPk);
		}
	} catch (err) {
		apiLogger.error(
			{ err, userId: input.userId, group: input.group },
			'Authentik group change failed'
		);
		return {
			ok: false,
			error: `Authentik update failed: ${err instanceof Error ? err.message : 'unknown error'}`
		};
	}

	const nextGroups =
		input.action === 'add' ? [...groups, input.group] : groups.filter((g) => g !== input.group);

	await db
		.update(userTable)
		.set({ groups: JSON.stringify(nextGroups), updatedAt: new Date() })
		.where(eq(userTable.id, input.userId));

	// Role changes go on the membership audit trail; grant groups do not — they
	// are access to a tool, not a change in standing, and recording every
	// newsletter toggle would bury the transitions that matter.
	if (MANAGEABLE_GROUPS[input.group].kind === 'role') {
		await db.insert(membershipEvents).values({
			userId: input.userId,
			fromRole: resolveRole(groups),
			toRole: resolveRole(nextGroups),
			reason:
				input.action === 'add'
					? `Granted ${MANAGEABLE_GROUPS[input.group].label}`
					: `Removed ${MANAGEABLE_GROUPS[input.group].label}`,
			actorUserId: input.actorUserId
		});
	}

	apiLogger.info(
		{
			userId: input.userId,
			group: input.group,
			action: input.action,
			actorUserId: input.actorUserId
		},
		'Group membership updated'
	);

	return { ok: true, groups: nextGroups };
}
