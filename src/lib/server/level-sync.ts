/**
 * One-off sync of every member's Offcoin level into the local snapshot.
 *
 * `saveOffcoinSnapshot` keeps the cache fresh from here on, but only for members
 * whose page happens to fetch it. Accounts that have not signed in since the fix
 * would keep a null level indefinitely — and those are exactly the accounts a
 * level question is being asked about.
 *
 * The reason this is worth running rather than waiting: `can()` reads the cached
 * level, and every display coalesces null to 0. Offcoin has no null level —
 * accounts start at 0 — so an unsynced member is indistinguishable from a member
 * who has genuinely earned nothing. One of those is a fact about a person and
 * the other is a fact about our bookkeeping, and until this runs the OS cannot
 * tell you which it is looking at.
 *
 * Sequential on purpose. It is an admin-triggered one-off over a community-sized
 * list, and a burst of parallel requests at Offcoin buys nothing a steward will
 * notice.
 */

import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { NotFoundError } from '@offcoin/sdk';
import { POLICY, parseGroupsJson, resolveRole, type Role } from '$lib/policy';
import { getOffcoinClient, memberAlias } from '$lib/server/offcoin';
import { saveOffcoinSnapshot } from '$lib/server/offcoin-snapshot';
import { offcoinLogger } from '$lib/server/logger';

export interface LevelSyncRow {
	userId: string;
	name: string;
	email: string;
	role: Role;
	xp: number;
	level: number;
	/** Previous cached level, or null when this is the first reading. */
	previousLevel: number | null;
	/**
	 * Holds the Member group (or higher) while sitting under the level that earns
	 * it. True here is not a verdict — the backfill grandfathered people in
	 * deliberately — but it is the list worth looking at when deciding whether
	 * anyone should be moved back to trial.
	 */
	belowMemberLevel: boolean;
}

export interface LevelSyncResult {
	total: number;
	/** Read from Offcoin and written to the snapshot. */
	synced: number;
	/** No `puckstackUserId`, so there is no alias to look up. */
	skippedNoLink: number;
	/** Exited; their snapshot was cleared on the way out and should stay clear. */
	skippedExited: number;
	/** Alias resolves to nothing in Offcoin — usually a member never created. */
	notFoundInOffcoin: { email: string }[];
	/** Every member read, with the figures. */
	members: LevelSyncRow[];
	failed: { email: string; error: string }[];
}

export async function syncOffcoinLevels(
	actorUserId: string | null,
	dryRun = false
): Promise<LevelSyncResult> {
	const result: LevelSyncResult = {
		total: 0,
		synced: 0,
		skippedNoLink: 0,
		skippedExited: 0,
		notFoundInOffcoin: [],
		members: [],
		failed: []
	};

	const users = await db.select().from(userTable);
	result.total = users.length;
	const offcoin = getOffcoinClient();

	for (const u of users) {
		if (u.membershipStatus === 'exited') {
			result.skippedExited++;
			continue;
		}
		if (!u.puckstackUserId) {
			result.skippedNoLink++;
			continue;
		}

		try {
			const xpData = await offcoin.members.getXp(memberAlias(u.puckstackUserId));
			const role = resolveRole(parseGroupsJson(u.groups));

			result.members.push({
				userId: u.id,
				name: u.name,
				email: u.email,
				role,
				xp: xpData.xp,
				level: xpData.level,
				previousLevel: u.offcoinLevel ?? null,
				belowMemberLevel: role !== 'trial' && xpData.level < POLICY.levels.memberFromLevel
			});

			// Count the write, not the read. saveOffcoinSnapshot swallows database
			// errors by design — right for the request-path callers, wrong here,
			// where reporting a sync that never landed is the whole failure mode
			// this endpoint would be trusted to rule out.
			if (dryRun) {
				result.synced++;
			} else {
				const written = await saveOffcoinSnapshot(u.id, {
					memberId: xpData.memberId,
					xp: xpData.xp,
					level: xpData.level
				});
				if (written) {
					result.synced++;
				} else {
					result.members.pop();
					result.failed.push({ email: u.email, error: 'Snapshot could not be written' });
				}
			}
		} catch (err) {
			if (err instanceof NotFoundError) {
				result.notFoundInOffcoin.push({ email: u.email });
				continue;
			}
			result.failed.push({
				email: u.email,
				error: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}

	// Sorted lowest level first: the question this run exists to answer is who is
	// at the bottom, so put them at the top.
	result.members.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

	offcoinLogger.info(
		{
			actorUserId,
			dryRun,
			total: result.total,
			synced: result.synced,
			belowMemberLevel: result.members.filter((m) => m.belowMemberLevel).length,
			notFound: result.notFoundInOffcoin.length,
			failed: result.failed.length
		},
		'Offcoin level sync'
	);

	return result;
}
