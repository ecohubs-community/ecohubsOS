/**
 * One-time (idempotent) seeding of `lastParticipationAt` from session history.
 *
 * Participation tracking started at deploy, so every account that existed
 * before it began with a null timestamp. The review evaluator treats null as
 * "no evidence" and stays silent — correct, since the alternative would have
 * proposed exiting the whole community on the first run, but it has a
 * consequence worth naming: **an inactive member's clock never starts.** It
 * begins at their next login, and someone who has been gone six months is
 * exactly the person who will not log in. The inactivity rule is unenforceable
 * against the people it was written for.
 *
 * Seeding from `session.createdAt` fixes that with a signal we already hold. A
 * session row is written when someone actually signs in, which is the same
 * event `recordLogin` treats as participation — so this is the history that
 * tracking would have recorded had it existed, not a new definition.
 *
 * Deliberately conservative:
 *
 * - Only accounts with **no** timestamp are touched. Anyone already recorded
 *   has a real signal, possibly stronger than a login, and it is left alone.
 * - Forward-only, mirroring {@link recordParticipation}: the write is guarded
 *   so a concurrent real signal cannot be dragged backwards by this.
 * - Accounts with no session are skipped rather than dated. They have never
 *   signed in, and inventing a date would start a clock against someone the
 *   system has never seen.
 * - Exited accounts are skipped. Their status is terminal and a timestamp
 *   would only add noise.
 */

import { db } from '$lib/server/db';
import { session as sessionTable, user as userTable } from '$lib/server/db/schema';
import { and, eq, isNull, lt, max, or } from 'drizzle-orm';
import { apiLogger } from '$lib/server/logger';

export interface ParticipationBackfillResult {
	/** Accounts examined. */
	total: number;
	/** Newly given a timestamp. */
	seeded: number;
	/** Already had one — the idempotent path. */
	alreadyRecorded: number;
	/** No session on record, so nothing to seed from. */
	skippedNoSession: number;
	/** Exited; their clock is over. */
	skippedExited: number;
	/**
	 * Who was (or would be) seeded and to when, so the effect on the review
	 * queue can be judged before it is real rather than after.
	 */
	seededMembers: { userId: string; name: string; email: string; lastLoginAt: string }[];
	failed: { email: string; error: string }[];
}

export async function backfillParticipation(
	actorUserId: string | null,
	dryRun = false
): Promise<ParticipationBackfillResult> {
	const result: ParticipationBackfillResult = {
		total: 0,
		seeded: 0,
		alreadyRecorded: 0,
		skippedNoSession: 0,
		skippedExited: 0,
		seededMembers: [],
		failed: []
	};

	const users = await db.select().from(userTable);
	result.total = users.length;

	// One grouped query rather than a lookup per member — sessions accumulate
	// with every sign-in a community has ever made.
	const lastSessions = await db
		.select({ userId: sessionTable.userId, at: max(sessionTable.createdAt) })
		.from(sessionTable)
		.groupBy(sessionTable.userId);

	const lastLoginByUser = new Map<string, Date>();
	for (const row of lastSessions) {
		if (row.at === null || row.at === undefined) continue;
		// `max()` bypasses drizzle's timestamp decoding, so revive the raw value.
		const at = row.at instanceof Date ? row.at : new Date(Number(row.at) * 1000);
		if (!Number.isNaN(at.getTime())) lastLoginByUser.set(row.userId, at);
	}

	for (const u of users) {
		if (u.lastParticipationAt) {
			result.alreadyRecorded++;
			continue;
		}
		if (u.membershipStatus === 'exited') {
			result.skippedExited++;
			continue;
		}

		const lastLoginAt = lastLoginByUser.get(u.id);
		if (!lastLoginAt) {
			result.skippedNoSession++;
			continue;
		}

		const entry = {
			userId: u.id,
			name: u.name,
			email: u.email,
			lastLoginAt: lastLoginAt.toISOString()
		};

		if (dryRun) {
			result.seeded++;
			result.seededMembers.push(entry);
			continue;
		}

		try {
			// `.returning()` because a zero-row UPDATE does not throw: if the guard
			// below excludes this member, the call succeeds having written nothing,
			// and counting that as seeded would report work that never happened.
			const written = await db
				.update(userTable)
				.set({
					lastParticipationAt: lastLoginAt,
					lastParticipationSource: 'login',
					updatedAt: new Date()
				})
				.where(
					and(
						eq(userTable.id, u.id),
						// Forward-only, the same guard recordParticipation uses. A real
						// signal arriving mid-run wins whenever it is more recent; when it
						// is older, the login is still the truer answer to "last active",
						// so taking the later of the two is right in both directions.
						or(
							isNull(userTable.lastParticipationAt),
							lt(userTable.lastParticipationAt, lastLoginAt)
						)
					)
				)
				.returning({ id: userTable.id });

			if (written.length > 0) {
				result.seeded++;
				result.seededMembers.push(entry);
			} else {
				// A concurrent write got there first with something at least as
				// recent. Not a failure — the member has a better timestamp than the
				// one being reconstructed.
				result.alreadyRecorded++;
			}
		} catch (err) {
			result.failed.push({
				email: u.email,
				error: err instanceof Error ? err.message : 'Unknown error'
			});
		}
	}

	apiLogger.info(
		{
			actorUserId,
			dryRun,
			total: result.total,
			seeded: result.seeded,
			skippedNoSession: result.skippedNoSession,
			failed: result.failed.length
		},
		'Participation backfill'
	);

	return result;
}
