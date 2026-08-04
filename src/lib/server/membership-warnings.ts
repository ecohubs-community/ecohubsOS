/**
 * Sending the advance warnings.
 *
 * A member should hear that their membership is about to change *before* it
 * lands in anyone's review queue, and while one ordinary act of participation
 * would still reset the clock.
 *
 * Runs lazily on read alongside the review evaluator, since this repo has no
 * scheduler.
 */

import { db } from '$lib/server/db';
import { membershipWarnings, user as userTable } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { parseGroupsJson, resolveRole, type MembershipStatus } from '$lib/policy';
import {
	cycleAnchor,
	daysUntilTransition,
	dueWarningMarks,
	evaluateMembership,
	type MembershipSnapshot
} from '$lib/server/membership-review';
import { buildTimerWarningTemplate } from '$lib/server/membership-emails';
import { renderBrandedEmailHtml } from '$lib/server/member-onboarding/emailTemplates';
import { sendEmail } from '$lib/email';
import { emailLogger } from '$lib/server/logger';

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
 * Which transition a member's countdown is heading toward.
 *
 * Reuses the evaluator by asking it what it *would* propose if the threshold
 * had already elapsed, so the warning can never describe a different outcome
 * from the proposal that eventually appears.
 */
function pendingKind(member: MembershipSnapshot): { kind: string; toStatus: string } | null {
	const anchor = cycleAnchor(member);
	if (!anchor) return null;

	// Evaluate at a point far past the threshold; we only want the shape.
	const hypothetical = evaluateMembership(member, new Date(8.64e15));
	return hypothetical ? { kind: hypothetical.kind, toStatus: hypothetical.toStatus } : null;
}

/**
 * Send any advance warnings that have come due.
 *
 * Idempotent per cycle: a unique index on (user, mark, cycleAnchor) means a
 * warning is sent once per countdown, and a member who participates and later
 * goes quiet again gets a fresh set.
 *
 * When several marks are due at once — which happens whenever the app was quiet
 * across a mark — only the most urgent is emailed. The rest are recorded with
 * `emailSent: false` so they cannot fire later, without claiming a message went
 * out that did not.
 *
 * Returns the number of emails actually sent.
 */
export async function sendDueWarnings(now: Date = new Date()): Promise<number> {
	const users = await db.select().from(userTable);
	const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
	let sent = 0;

	for (const u of users) {
		if (u.membershipStatus === 'exited') continue;

		const member = toSnapshot(u);
		const marks = dueWarningMarks(member, now);
		if (marks.length === 0) continue;

		const anchor = cycleAnchor(member);
		const pending = pendingKind(member);
		if (!anchor || !pending) continue;

		// Most urgent first; anything after it is superseded.
		const [urgent, ...superseded] = marks;

		const alreadySent = await db
			.select({ daysBefore: membershipWarnings.daysBefore })
			.from(membershipWarnings)
			.where(and(eq(membershipWarnings.userId, u.id), eq(membershipWarnings.cycleAnchor, anchor)));
		const seen = new Set(alreadySent.map((w) => w.daysBefore));

		if (seen.has(urgent)) continue;

		const remaining = daysUntilTransition(member, now) ?? urgent;
		const template = buildTimerWarningTemplate({
			recipientName: u.displayName?.trim() || u.name,
			daysRemaining: remaining,
			toStatus: pending.toStatus,
			isStandbyCycle: member.status === 'standby',
			appUrl
		});

		// Claim first: the insert's unique index is what makes this safe against
		// two concurrent reads both deciding to send.
		try {
			await db.insert(membershipWarnings).values({
				userId: u.id,
				daysBefore: urgent,
				cycleAnchor: anchor,
				kind: pending.kind,
				emailSent: true
			});
		} catch {
			continue; // Another request claimed it.
		}

		// Record the less urgent marks as superseded so they cannot fire later.
		for (const mark of superseded) {
			if (seen.has(mark)) continue;
			try {
				await db.insert(membershipWarnings).values({
					userId: u.id,
					daysBefore: mark,
					cycleAnchor: anchor,
					kind: pending.kind,
					emailSent: false
				});
			} catch {
				// Already recorded — fine.
			}
		}

		try {
			await sendEmail({
				to: u.email,
				subject: template.subject,
				text: template.body,
				html: renderBrandedEmailHtml(template.body)
			});
			sent++;
			emailLogger.info({ userId: u.id, daysBefore: urgent }, 'Membership warning sent');
		} catch (err) {
			// The claim stays. Retrying would mean re-sending to everyone whose
			// send happened to fail, and a missed warning is a smaller harm than a
			// duplicate one — the review still goes to a human either way.
			emailLogger.error({ err, userId: u.id }, 'Membership warning email failed');
		}
	}

	return sent;
}
