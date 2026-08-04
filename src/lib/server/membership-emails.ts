/**
 * Reactivation outcome emails.
 *
 * A member cannot see their own reactivation vote — the visibility rules
 * exclude it, which is what keeps the decision free of campaigning. That makes
 * the email the *only* way they learn the outcome, so it has to be reliable and
 * it has to be kind.
 *
 * A rejected member is never told the voters or their reasons. That was an
 * explicit decision: the vote is confidential in both directions.
 */

import { db } from '$lib/server/db';
import { proposals } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { sendEmail } from '$lib/email';
import { POLICY } from '$lib/policy';
import { renderBrandedEmailHtml } from '$lib/server/member-onboarding/emailTemplates';
import { emailLogger } from '$lib/server/logger';

export interface EmailTemplate {
	subject: string;
	body: string;
}

/** Approved — they're back. */
export function buildReactivationApprovedTemplate(opts: {
	recipientName: string;
	appUrl: string;
}): EmailTemplate {
	return {
		subject: 'Welcome back to EcoHubs',
		body: `Hi ${opts.recipientName},

Good news — the community voted to reactivate your membership. Your access is
already restored, so you can pick up wherever you left off:

${opts.appUrl}

There's no catch-up expected. Take whatever pace suits you.

Warmly,
The EcoHubs community`
	};
}

/**
 * Not approved.
 *
 * Deliberately gives no vote counts and no reasons. Someone reading this is
 * having a bad day; the message should be short, final about the outcome, and
 * clear that the door is not permanently shut.
 */
export function buildReactivationRejectedTemplate(opts: {
	recipientName: string;
	canReapplyOn: string;
}): EmailTemplate {
	return {
		subject: 'About your EcoHubs reactivation request',
		body: `Hi ${opts.recipientName},

Thank you for asking to come back. The community has voted, and this time your
reactivation wasn't approved. Your membership stays on standby.

That isn't a permanent door closing. You're welcome to ask again from
${opts.canReapplyOn}, and a lot can change in that time.

If you'd like to talk it through with a steward, just reply to this email — a
real person reads every message.

Warmly,
The EcoHubs community`
	};
}

/** Nobody voted, or the ballot was inconclusive — a steward will decide. */
export function buildReactivationNeedsReviewTemplate(opts: {
	recipientName: string;
}): EmailTemplate {
	return {
		subject: 'Your EcoHubs reactivation request is being reviewed',
		body: `Hi ${opts.recipientName},

Your reactivation request has finished its voting window without a clear
outcome, so one of our stewards is taking a look at it personally.

There's nothing you need to do — they'll be in touch shortly.

Warmly,
The EcoHubs community`
	};
}

/**
 * Claim the right to send a notification for a proposal transition.
 *
 * Reuses `discordNotifiedTransitions` — the same atomic claim the Discord
 * notifier uses, keyed separately with an `email:` prefix. `materialiseProposal`
 * runs lazily on read, so the same transition can be observed by several
 * concurrent requests; without this, a member could be emailed their outcome
 * several times.
 *
 * Returns true only for the caller that won the race.
 */
async function claimEmailNotification(proposalId: string, key: string): Promise<boolean> {
	const claimKey = `email:${key}`;
	const claim = await db
		.update(proposals)
		.set({
			discordNotifiedTransitions: sql`json_insert(${proposals.discordNotifiedTransitions}, '$[#]', ${claimKey})`
		})
		.where(
			and(
				eq(proposals.id, proposalId),
				sql`not exists (select 1 from json_each(${proposals.discordNotifiedTransitions}) where json_each.value = ${claimKey})`
			)
		)
		.returning({ id: proposals.id });

	return claim.length > 0;
}

/**
 * Email a member the outcome of their reactivation request.
 *
 * Idempotent and fire-and-forget: a send failure is logged, never thrown. The
 * membership change has already been applied by the time this runs, and an
 * email problem must not roll that back or fail the request that triggered it.
 */
export async function sendReactivationOutcomeEmail(opts: {
	proposalId: string;
	email: string;
	recipientName: string;
	result: 'approved' | 'rejected' | 'tied' | 'needs_review';
	voteClosedAt: Date | null;
	appUrl: string;
}): Promise<boolean> {
	const { proposalId, email, recipientName, result, voteClosedAt, appUrl } = opts;

	if (!(await claimEmailNotification(proposalId, `reactivation:${result}`))) {
		return false; // Another request already sent it.
	}

	let template: EmailTemplate;
	if (result === 'approved') {
		template = buildReactivationApprovedTemplate({ recipientName, appUrl });
	} else if (result === 'needs_review') {
		template = buildReactivationNeedsReviewTemplate({ recipientName });
	} else {
		// `tied` counts as not approved — the status quo holds, which for a
		// reactivation means staying on standby.
		const base = voteClosedAt ?? new Date();
		const canReapply = new Date(base.getTime() + POLICY.reactivation.cooldownDays * 86_400_000);
		template = buildReactivationRejectedTemplate({
			recipientName,
			canReapplyOn: canReapply.toLocaleDateString('en-GB', {
				day: 'numeric',
				month: 'long',
				year: 'numeric'
			})
		});
	}

	try {
		await sendEmail({
			to: email,
			subject: template.subject,
			text: template.body,
			// Same branded shell as the onboarding emails, so these do not arrive
			// looking like a different system.
			html: renderBrandedEmailHtml(template.body)
		});
		emailLogger.info({ proposalId, result }, 'Reactivation outcome email sent');
		return true;
	} catch (err) {
		emailLogger.error({ err, proposalId, result }, 'Reactivation outcome email failed');
		return false;
	}
}
