/**
 * Persistence for the membership review queue.
 *
 * `materialiseMembershipReviews()` is the lazy evaluator — the same idiom as
 * `materialiseProposal`, since this repo has no scheduler. It runs on read,
 * proposes what the timers have surfaced, and applies nothing.
 *
 * Applying a proposal is a separate, explicit act by a steward or admin
 * ({@link resolveReview}).
 */

import { db } from '$lib/server/db';
import { membershipEvents, membershipReviews, user as userTable } from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { parseGroupsJson, resolveRole, type MembershipStatus } from '$lib/policy';
import { evaluateMembership, type MembershipSnapshot } from '$lib/server/membership-review';
import { apiLogger } from '$lib/server/logger';

export interface ReviewRow {
	id: string;
	userId: string;
	email: string;
	displayName: string;
	kind: string;
	fromStatus: string;
	toStatus: string;
	reason: string;
	daysElapsed: number;
	thresholdDays: number;
	createdAt: string | null;
}

/** Build the evaluator's input from a user row. */
function toSnapshot(u: typeof userTable.$inferSelect): MembershipSnapshot {
	return {
		userId: u.id,
		role: resolveRole(parseGroupsJson(u.groups)),
		status: (u.membershipStatus ?? 'active') as MembershipStatus,
		lastParticipationAt: u.lastParticipationAt ?? null,
		membershipStatusSince: u.membershipStatusSince ?? null
	};
}

/**
 * Evaluate every account and queue any newly elapsed timer.
 *
 * Idempotent: a partial unique index allows one pending review per member, and
 * an existing pending review short-circuits before the insert. Re-running is
 * therefore free, which is what makes lazy evaluation on read safe.
 *
 * Returns the number of reviews created.
 */
export async function materialiseMembershipReviews(now: Date = new Date()): Promise<number> {
	const users = await db.select().from(userTable);

	const pending = await db
		.select({ userId: membershipReviews.userId })
		.from(membershipReviews)
		.where(eq(membershipReviews.status, 'pending'));
	const alreadyQueued = new Set(pending.map((p) => p.userId));

	let created = 0;

	for (const u of users) {
		if (alreadyQueued.has(u.id)) continue;

		const proposal = evaluateMembership(toSnapshot(u), now);
		if (!proposal) continue;

		try {
			await db.insert(membershipReviews).values({
				userId: proposal.userId,
				kind: proposal.kind,
				fromStatus: proposal.fromStatus,
				toStatus: proposal.toStatus,
				reason: proposal.reason,
				daysElapsed: proposal.daysElapsed,
				thresholdDays: proposal.thresholdDays
			});
			created++;
		} catch (err) {
			// Lost a race with a concurrent evaluation — the unique index did its
			// job, and the other run queued it. Not an error.
			apiLogger.debug?.({ err, userId: u.id }, 'Review already queued');
		}
	}

	if (created > 0) {
		apiLogger.info({ created }, 'Membership reviews queued');
	}
	return created;
}

/** Pending reviews, newest first, with enough member detail to decide on. */
export async function listPendingReviews(): Promise<ReviewRow[]> {
	const rows = await db
		.select({
			review: membershipReviews,
			email: userTable.email,
			name: userTable.name,
			displayName: userTable.displayName
		})
		.from(membershipReviews)
		.innerJoin(userTable, eq(userTable.id, membershipReviews.userId))
		.where(eq(membershipReviews.status, 'pending'))
		.orderBy(desc(membershipReviews.createdAt));

	return rows.map(({ review, email, name, displayName }) => ({
		id: review.id,
		userId: review.userId,
		email,
		displayName: displayName?.trim() || name,
		kind: review.kind,
		fromStatus: review.fromStatus,
		toStatus: review.toStatus,
		reason: review.reason,
		daysElapsed: review.daysElapsed,
		thresholdDays: review.thresholdDays,
		createdAt: review.createdAt?.toISOString() ?? null
	}));
}

export type Resolution = 'apply' | 'dismiss';

/**
 * Resolve a pending review.
 *
 * `apply` performs the status change the timer proposed and records it on the
 * membership audit trail with the deciding steward attached — this is the only
 * path by which a timer ever changes anything.
 *
 * `dismiss` closes the review without touching the membership. The member's
 * timer keeps running, so if they stay inactive a fresh review appears later;
 * dismissing is "not now", not "never".
 *
 * ⚠️ Applying an exit sets the status only. Revoking Authentik access, the
 * Discord role and the newsletter subscription is `executeExit()`, which is
 * Phase 6 — until then an applied exit blocks the OS (the policy checks status
 * first) but leaves external access in place.
 */
export async function resolveReview(
	reviewId: string,
	resolution: Resolution,
	actorUserId: string,
	note?: string
): Promise<{ ok: boolean; error?: string }> {
	const review = await db.query.membershipReviews.findFirst({
		where: and(eq(membershipReviews.id, reviewId), eq(membershipReviews.status, 'pending'))
	});
	if (!review) return { ok: false, error: 'Review not found or already resolved' };

	const now = new Date();

	if (resolution === 'apply') {
		await db
			.update(userTable)
			.set({
				membershipStatus: review.toStatus,
				membershipStatusSince: now,
				updatedAt: now
			})
			.where(eq(userTable.id, review.userId));

		await db.insert(membershipEvents).values({
			userId: review.userId,
			fromStatus: review.fromStatus,
			toStatus: review.toStatus,
			reason: note?.trim() || review.reason,
			actorUserId
		});
	}

	await db
		.update(membershipReviews)
		.set({
			status: resolution === 'apply' ? 'applied' : 'dismissed',
			resolvedAt: now,
			resolvedBy: actorUserId,
			resolutionNote: note?.trim() || null
		})
		.where(eq(membershipReviews.id, reviewId));

	apiLogger.info(
		{ reviewId, resolution, userId: review.userId, actorUserId },
		'Membership review resolved'
	);
	return { ok: true };
}
