/**
 * One-time (idempotent) backfill: put every existing account into the
 * `EcoHubs Member` Authentik group.
 *
 * Until this runs, `resolveRole` reports `trial` for everyone who is not a
 * steward or admin, because a trial member is defined by the *absence* of a
 * role group. That is harmless while nothing enforces member-level
 * capabilities — but it must land before the vote gate ships, or the whole
 * community loses the vote it has today.
 *
 * Authentik is the source of truth for roles, but its group claim only
 * refreshes on the user's next OIDC login, so each change is mirrored into the
 * local `user.groups` JSON for immediate effect — the same write-through the
 * steward toggle uses.
 */

import { db } from '$lib/server/db';
import { user as userTable, membershipEvents } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { ROLE_GROUPS, parseGroupsJson, resolveRole } from '$lib/policy';
import {
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	addUserToAuthentikGroup
} from '$lib/server/authentik';
import { apiLogger } from '$lib/server/logger';

export interface BackfillResult {
	/** Accounts examined. */
	total: number;
	/** Newly added to the Member group. */
	added: number;
	/** Already held it — the idempotent path. */
	alreadyMember: number;
	/** Skipped because their status is not `active`. */
	skippedInactive: number;
	/**
	 * Who would be (or was) added, so the decision to grandfather someone is
	 * made with names in front of you rather than a count. The group was
	 * historically assigned by the Authentik enrollment flow, so who already
	 * holds it reflects *when* they enrolled, not what they have contributed —
	 * the people in this list are not necessarily newer or less active.
	 */
	addedMembers: { email: string; name: string }[];
	/** Failed, with the reason. Reported rather than thrown, so one bad row
	 *  cannot abandon the rest of the run half-done. */
	failed: { email: string; error: string }[];
}

/**
 * Add every active account to the Member group.
 *
 * Idempotent: accounts that already hold the group are counted and skipped, so
 * re-running after a partial failure only retries what is still missing.
 *
 * @param actorUserId - admin who triggered the run, recorded on each event
 * @param dryRun - report what would change without writing anything
 */
export async function backfillMemberGroup(
	actorUserId: string | null,
	dryRun = false
): Promise<BackfillResult> {
	const result: BackfillResult = {
		total: 0,
		added: 0,
		alreadyMember: 0,
		skippedInactive: 0,
		addedMembers: [],
		failed: []
	};

	// Resolve the group once — if it does not exist, fail loudly before touching
	// a single account rather than reporting N identical failures.
	const groupUuid = await getAuthentikGroupByName(ROLE_GROUPS.member);
	if (!groupUuid) {
		throw new Error(
			`Authentik group "${ROLE_GROUPS.member}" not found — create it before running the backfill`
		);
	}

	const users = await db.select().from(userTable);
	result.total = users.length;

	for (const u of users) {
		const groups = parseGroupsJson(u.groups);

		if (groups.includes(ROLE_GROUPS.member)) {
			result.alreadyMember++;
			continue;
		}

		// Exited and standby accounts keep whatever role they have; granting
		// membership here would quietly reinstate someone who left.
		if (u.membershipStatus !== 'active') {
			result.skippedInactive++;
			continue;
		}

		if (dryRun) {
			result.added++;
			result.addedMembers.push({ email: u.email, name: u.name });
			continue;
		}

		try {
			const authentikUserPk = await getAuthentikUserByEmail(u.email);
			if (authentikUserPk === null) {
				result.failed.push({ email: u.email, error: 'No Authentik user for this email' });
				continue;
			}

			await addUserToAuthentikGroup(groupUuid, authentikUserPk);

			const fromRole = resolveRole(groups);
			const nextGroups = [...groups, ROLE_GROUPS.member];

			await db
				.update(userTable)
				.set({ groups: JSON.stringify(nextGroups), updatedAt: new Date() })
				.where(eq(userTable.id, u.id));

			await db.insert(membershipEvents).values({
				userId: u.id,
				fromRole,
				toRole: resolveRole(nextGroups),
				reason: 'Backfill: grandfathered into the Member group',
				actorUserId
			});

			result.added++;
			result.addedMembers.push({ email: u.email, name: u.name });
		} catch (err) {
			const error = err instanceof Error ? err.message : 'Unknown error';
			apiLogger.error({ err, userId: u.id }, 'Member group backfill failed for user');
			result.failed.push({ email: u.email, error });
		}
	}

	// Counts only — `addedMembers` and `failed` carry emails, which belong in the
	// admin's response, not in the log stream.
	apiLogger.info(
		{
			dryRun,
			total: result.total,
			added: result.added,
			alreadyMember: result.alreadyMember,
			skippedInactive: result.skippedInactive,
			failedCount: result.failed.length
		},
		'Member group backfill complete'
	);
	return result;
}
