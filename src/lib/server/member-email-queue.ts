/**
 * The outbound member email queue.
 *
 * Every membership message drafts into here rather than going straight out. A
 * steward reads it, edits the wording if it needs it, and sends — or dismisses
 * it as unnecessary. Nothing reaches a member's inbox without someone choosing
 * to send it.
 *
 * `POLICY.emails.autoSend` names the handful of exceptions: transactional mail
 * a member is actively waiting on, where the delay would itself be the failure.
 * Those send immediately and are still recorded here, so the queue doubles as
 * the log of everything the system has ever sent a member.
 */

import { db } from '$lib/server/db';
import { memberEmails, user as userTable } from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { POLICY } from '$lib/policy';
import { sendEmail } from '$lib/email';
import { renderBrandedEmailHtml } from '$lib/server/member-onboarding/emailTemplates';
import { emailLogger } from '$lib/server/logger';

export type EmailKind = keyof typeof POLICY.emails.autoSend;

export interface QueuedEmail {
	id: string;
	userId: string;
	email: string;
	displayName: string;
	kind: string;
	subject: string;
	body: string;
	relatedId: string | null;
	createdAt: string | null;
}

/**
 * Draft an email for a member.
 *
 * Deduped on (user, kind, relatedId) by a partial unique index, so the lazy
 * evaluators can call this on every read without piling up drafts for the same
 * event. Returns null when one already exists.
 *
 * Sends immediately only if the kind is in `POLICY.emails.autoSend`.
 */
export async function queueMemberEmail(input: {
	userId: string;
	email: string;
	kind: EmailKind;
	subject: string;
	body: string;
	relatedId?: string | null;
}): Promise<{ id: string; sent: boolean } | null> {
	const autoSend = POLICY.emails.autoSend[input.kind] ?? false;

	let row;
	try {
		[row] = await db
			.insert(memberEmails)
			.values({
				userId: input.userId,
				email: input.email,
				kind: input.kind,
				subject: input.subject,
				body: input.body,
				relatedId: input.relatedId ?? null,
				status: autoSend ? 'sent' : 'pending',
				sentAt: autoSend ? new Date() : null
			})
			.returning();
	} catch {
		return null; // Already drafted for this event.
	}

	if (!autoSend) {
		emailLogger.info({ id: row.id, kind: input.kind }, 'Member email queued for review');
		return { id: row.id, sent: false };
	}

	try {
		await sendEmail({
			to: input.email,
			subject: input.subject,
			text: input.body,
			html: renderBrandedEmailHtml(input.body)
		});
		return { id: row.id, sent: true };
	} catch (err) {
		emailLogger.error({ err, id: row.id }, 'Auto-send failed; left for a steward');
		// Fall back to the queue rather than dropping it — a failed automatic send
		// becomes a human's problem, which is the safer direction.
		await db
			.update(memberEmails)
			.set({ status: 'pending', sentAt: null })
			.where(eq(memberEmails.id, row.id));
		return { id: row.id, sent: false };
	}
}

/** Drafts awaiting a decision, newest first. */
export async function listPendingEmails(): Promise<QueuedEmail[]> {
	const rows = await db
		.select({
			mail: memberEmails,
			name: userTable.name,
			displayName: userTable.displayName
		})
		.from(memberEmails)
		.innerJoin(userTable, eq(userTable.id, memberEmails.userId))
		.where(eq(memberEmails.status, 'pending'))
		.orderBy(desc(memberEmails.createdAt));

	return rows.map(({ mail, name, displayName }) => ({
		id: mail.id,
		userId: mail.userId,
		email: mail.email,
		displayName: displayName?.trim() || name,
		kind: mail.kind,
		subject: mail.subject,
		body: mail.body,
		relatedId: mail.relatedId,
		createdAt: mail.createdAt?.toISOString() ?? null
	}));
}

/** How many drafts are waiting — drives the app badge. */
export async function countPendingEmails(): Promise<number> {
	const rows = await db
		.select({ id: memberEmails.id })
		.from(memberEmails)
		.where(eq(memberEmails.status, 'pending'));
	return rows.length;
}

/**
 * Send a queued draft, optionally with the steward's own wording.
 *
 * The edit is saved whether or not delivery succeeds, so a retry after an SMTP
 * problem does not lose what they wrote.
 */
export async function sendQueuedEmail(
	id: string,
	actorUserId: string,
	overrides?: { subject?: string; body?: string }
): Promise<{ ok: boolean; error?: string }> {
	const [row] = await db
		.select()
		.from(memberEmails)
		.where(and(eq(memberEmails.id, id), eq(memberEmails.status, 'pending')))
		.limit(1);
	if (!row) return { ok: false, error: 'Draft not found or already handled' };

	const subject = overrides?.subject?.trim() || row.subject;
	const body = overrides?.body?.trim() || row.body;

	if (subject !== row.subject || body !== row.body) {
		await db.update(memberEmails).set({ subject, body }).where(eq(memberEmails.id, id));
	}

	try {
		await sendEmail({
			to: row.email,
			subject,
			text: body,
			html: renderBrandedEmailHtml(body)
		});
	} catch (err) {
		emailLogger.error({ err, id }, 'Queued member email failed to send');
		// Stays pending so it can be retried; the steward's edit is already saved.
		return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
	}

	await db
		.update(memberEmails)
		.set({ status: 'sent', sentAt: new Date(), sentBy: actorUserId })
		.where(eq(memberEmails.id, id));

	emailLogger.info({ id, kind: row.kind, actorUserId }, 'Member email sent by steward');
	return { ok: true };
}

/** Decide not to send a draft. Recorded rather than deleted. */
export async function dismissQueuedEmail(
	id: string,
	actorUserId: string,
	reason?: string
): Promise<{ ok: boolean; error?: string }> {
	const result = await db
		.update(memberEmails)
		.set({
			status: 'dismissed',
			sentBy: actorUserId,
			dismissedReason: reason?.trim() || null
		})
		.where(and(eq(memberEmails.id, id), eq(memberEmails.status, 'pending')))
		.returning({ id: memberEmails.id });

	if (result.length === 0) return { ok: false, error: 'Draft not found or already handled' };

	emailLogger.info({ id, actorUserId }, 'Member email dismissed');
	return { ok: true };
}
