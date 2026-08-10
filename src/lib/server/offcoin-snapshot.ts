/**
 * Keeping `user.offcoinXp` / `offcoinLevel` in step with Offcoin.
 *
 * Offcoin is the source of truth; the columns on `user` are a cache that the
 * membership gates read, because `can()` needs a level synchronously and cannot
 * make an HTTP call per check.
 *
 * That cache had only two writers — the XP webhook and a steward's grant — while
 * five endpoints *fetched* the live figures and threw them away. So a member who
 * had never triggered either kept a null level indefinitely, even though the OS
 * asked Offcoin for their real one several times a day. Null then read as level
 * 0 wherever it was displayed or gated, which is a claim about someone rather
 * than an admission that we never looked.
 *
 * This is the one place that write happens. Call it wherever the live figures
 * are already in hand — the fetch has been paid for, so persisting it is free.
 */

import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { offcoinLogger } from '$lib/server/logger';

export interface OffcoinSnapshot {
	memberId?: string | null;
	xp: number;
	level: number;
}

/**
 * Persist a snapshot already fetched from Offcoin.
 *
 * Never throws: every request-path caller is serving a response that has already
 * succeeded, and failing it because a cache write did not land would turn a
 * working page into an error. A stale cache is the lesser problem — the next
 * fetch refreshes it.
 *
 * Returns whether the write landed, so callers that *are* the operation — an
 * admin sync reporting what it did — can tell a silent failure from a success
 * instead of counting both the same.
 */
export async function saveOffcoinSnapshot(
	userId: string,
	snapshot: OffcoinSnapshot
): Promise<boolean> {
	// Guard against writing nonsense into a column the gates trust. Offcoin
	// levels start at 0, so 0 is a real value — but NaN and negatives are not.
	if (!Number.isFinite(snapshot.level) || !Number.isFinite(snapshot.xp)) return false;
	if (snapshot.level < 0 || snapshot.xp < 0) return false;

	try {
		await db
			.update(userTable)
			.set({
				...(snapshot.memberId ? { offcoinMemberId: snapshot.memberId } : {}),
				offcoinXp: snapshot.xp,
				offcoinLevel: snapshot.level,
				offcoinSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(userTable.id, userId));
		return true;
	} catch (err) {
		offcoinLogger.error({ err, userId }, 'Could not persist Offcoin snapshot');
		return false;
	}
}
