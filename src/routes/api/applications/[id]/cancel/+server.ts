import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { sendEmail } from '$lib/email';
import { apiLogger, emailLogger } from '$lib/server/logger';

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 2000;

// POST /api/applications/[id]/cancel — admin soft-deletes an application.
// If a linked proposal is still in flight (deliberating | active | closed),
// it transitions to `withdrawn` so it lands in the public "Past" tab with
// the admin's reason on it for transparency.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const userGroups: string[] = locals.user.groups
		? JSON.parse(locals.user.groups as unknown as string)
		: [];
	if (!userGroups.includes('EcoHubs Admin')) {
		error(403, 'Forbidden: Admin access required');
	}

	const { id } = params;

	let body: { reason?: unknown; sendRejectionEmail?: unknown; includeReasonInEmail?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : '';
	if (reasonRaw.length < MIN_REASON_LENGTH) {
		error(400, `Reason is required (min ${MIN_REASON_LENGTH} characters)`);
	}
	if (reasonRaw.length > MAX_REASON_LENGTH) {
		error(400, `Reason must be ≤ ${MAX_REASON_LENGTH} characters`);
	}
	const reason = reasonRaw;
	const sendRejectionEmail = body.sendRejectionEmail === true;
	const includeReasonInEmail = body.includeReasonInEmail === true;

	// Load the application
	const [application] = await db.select().from(applications).where(eq(applications.id, id));
	if (!application) {
		error(404, 'Application not found');
	}
	if (application.status === 'cancelled') {
		error(409, 'Application is already cancelled');
	}

	apiLogger.info(
		{ applicationId: id, adminId: locals.user.id, sendRejectionEmail, includeReasonInEmail },
		'Starting application cancellation flow'
	);

	// Step 1: Look up the linked proposal (if any) and decide whether to withdraw it.
	const [linkedProposal] = await db
		.select()
		.from(proposals)
		.where(eq(proposals.linkedApplicationId, id));

	if (linkedProposal) {
		const cancellable = ['deliberating', 'active', 'closed'] as const;
		const finalStates = ['ratifying', 'ratified', 'withdrawn'] as const;
		if (finalStates.includes(linkedProposal.status as (typeof finalStates)[number])) {
			error(
				409,
				`Linked proposal is in a final state (${linkedProposal.status}) and cannot be withdrawn`
			);
		}
		if (!cancellable.includes(linkedProposal.status as (typeof cancellable)[number])) {
			error(409, `Linked proposal status '${linkedProposal.status}' cannot be withdrawn`);
		}
	}

	const cancelledAt = new Date().toISOString();

	// Step 2: Update the application row (single source of truth for the reason)
	try {
		await db
			.update(applications)
			.set({
				status: 'cancelled',
				cancelledAt,
				cancellationReason: reason,
				cancelledBy: locals.user.id
			})
			.where(eq(applications.id, id));
	} catch (dbErr) {
		apiLogger.error({ err: dbErr, applicationId: id }, '[Step 1/3] Failed to update application');
		error(500, 'Failed to update application');
	}

	apiLogger.info({ applicationId: id }, '[Step 1/3] Application marked cancelled');

	// Step 3: Withdraw the linked proposal if there is one.
	if (linkedProposal) {
		try {
			await db
				.update(proposals)
				.set({ status: 'withdrawn' })
				.where(eq(proposals.id, linkedProposal.id));
			apiLogger.info(
				{ applicationId: id, proposalId: linkedProposal.id },
				'[Step 2/3] Linked proposal withdrawn'
			);
		} catch (dbErr) {
			apiLogger.error(
				{ err: dbErr, applicationId: id, proposalId: linkedProposal.id },
				'[Step 2/3] Failed to withdraw linked proposal'
			);
			error(500, 'Application marked cancelled, but failed to withdraw linked proposal');
		}
	} else {
		apiLogger.info({ applicationId: id }, '[Step 2/3] No linked proposal to withdraw');
	}

	// Step 4: Send rejection email (optional)
	let emailSentAt: string | null = null;
	if (sendRejectionEmail) {
		if (application.rejectionEmailSentAt) {
			apiLogger.warn(
				{ applicationId: id },
				'[Step 3/3] Rejection email already sent previously — skipping resend'
			);
		} else {
			const discordInviteUrl = env.DISCORD_INVITE_URL || 'https://discord.gg/ecohubs';
			const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
			const reasonForEmail = includeReasonInEmail ? reason : null;
			try {
				const emailResult = await sendEmail({
					to: application.email,
					subject: 'EcoHubs Community — Update on Your Membership Application',
					html: buildCancellationEmail(
						application.fullName,
						discordInviteUrl,
						appUrl,
						reasonForEmail
					),
					text: buildCancellationEmailText(
						application.fullName,
						discordInviteUrl,
						reasonForEmail
					)
				});
				emailSentAt = new Date().toISOString();
				await db
					.update(applications)
					.set({ rejectionEmailSentAt: emailSentAt })
					.where(eq(applications.id, id));
				apiLogger.info(
					{ applicationId: id, messageId: emailResult.messageId },
					'[Step 3/3] Rejection email sent'
				);
			} catch (emailErr) {
				emailLogger.error(
					{ err: emailErr, applicationId: id, to: application.email },
					'[Step 3/3] Failed to send rejection email after cancellation'
				);
				// Don't fail the cancel — the records are already updated.
			}
		}
	}

	const [updated] = await db.select().from(applications).where(eq(applications.id, id));

	return json({
		success: true,
		application: updated,
		proposalWithdrawn: !!linkedProposal,
		rejectionEmailSentAt: emailSentAt
	});
};

const FONT_INTER = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const FONT_PRIDI = `'Pridi', Georgia, 'Times New Roman', serif`;
const FONT_FRAUNCES = `'Fraunces', Georgia, 'Times New Roman', serif`;

// Mirrors the reject endpoint's email but with an optional admin-supplied
// reason paragraph injected before the reapply note.
function buildCancellationEmail(
	name: string,
	discordUrl: string,
	appUrl: string,
	reason: string | null
): string {
	const logoUrl = `${appUrl}/logo-symbol.png`;
	const reasonBlock = reason
		? `
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef7ed;border:1px solid #fcd9b6;border-radius:14px;margin:0 0 22px 0;">
					<tr><td style="padding:20px 22px;">
						<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#92400e;margin-bottom:8px;">A note from the team</div>
						<div style="font-family:${FONT_PRIDI};font-size:16px;line-height:1.6;color:#1c1917;white-space:pre-wrap;">${escapeHtml(reason)}</div>
					</td></tr>
				</table>
`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>An update on your EcoHubs application</title>
<style>
	body { margin:0; padding:0; background:#fbfbf9; }
	a { color:#064e3b; }
	@media (max-width: 640px) {
		.container { width:100% !important; border-radius:0 !important; }
		.px { padding-left:24px !important; padding-right:24px !important; }
		.hero-h1 { font-size:34px !important; line-height:1.08 !important; }
	}
</style>
</head>
<body style="margin:0;padding:0;background:#fbfbf9;font-family:${FONT_INTER};color:#1c1917;-webkit-font-smoothing:antialiased;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbfbf9;">
	<tr><td align="center" style="padding:32px 16px;">

		<table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#fbfbf9;border:1px solid #e7e2d4;border-radius:18px;overflow:hidden;">

			<tr><td style="background:#0b2e24;padding:22px 36px;" class="px">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
					<tr>
						<td align="left" style="font-family:${FONT_PRIDI};font-size:17px;color:#f5f2ea;font-weight:500;letter-spacing:0.01em;">
							<img src="${logoUrl}" alt="" width="24" height="24" style="display:inline-block;width:24px;height:24px;margin-right:10px;vertical-align:middle;border:0;outline:none;text-decoration:none;" />
							<span style="vertical-align:middle;">EcoHubs</span>
						</td>
						<td align="right" style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;color:#a7f3d0;font-weight:600;">
							A note from us
						</td>
					</tr>
				</table>
			</td></tr>

			<tr><td style="background:#f5f2ea;padding:56px 40px 48px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin:0 0 22px 0;">
					An honest update
				</div>
				<div class="hero-h1" style="font-family:${FONT_PRIDI};font-size:42px;line-height:1.06;color:#0b2e24;font-weight:500;letter-spacing:-0.01em;margin:0 0 22px 0;">
					Thank you for writing, ${escapeHtml(name)}.<br>
					<em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">— and for the trust it took.</em>
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:18px;line-height:1.6;color:#1c1917;max-width:480px;">
					After review, we're not able to offer you membership at this time.
				</div>
			</td></tr>

			<tr><td style="background:#fbfbf9;padding:40px 40px 16px 40px;" class="px">

				${reasonBlock}

				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f2ea;border-radius:14px;margin:8px 0 28px 0;">
					<tr><td style="padding:22px 24px;">
						<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:8px;">This isn't final</div>
						<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.4;margin-bottom:6px;">
							You're welcome to <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;">reapply after 6 months.</em>
						</div>
						<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;">
							People change. Communities change. We'd genuinely be glad to read a new application from you when the season feels right.
						</div>
					</td></tr>
				</table>

				<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-top:24px;">
					If you'd like to ask anything, write to us at <a href="mailto:info@ecohubs.community" style="color:#064e3b;text-decoration:none;border-bottom:1px solid #064e3b40;">info@ecohubs.community</a>. A person reads every message. The public space — Discord (<a href="${discordUrl}" style="color:#064e3b;">join</a>) and the Blueprint — stays open to you.
				</div>

			</td></tr>

			<tr><td style="background:#f5f2ea;padding:24px 40px;border-top:1px solid #e7e2d4;text-align:center;" class="px">
				<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:13px;color:#6b7265;line-height:1.6;">
					EcoHubs · Co-creating a regenerative way of life, one hub at a time.
				</div>
			</td></tr>

		</table>

	</td></tr>
</table>

</body>
</html>`;
}

function buildCancellationEmailText(
	name: string,
	discordUrl: string,
	reason: string | null
): string {
	const reasonBlock = reason ? `\nA NOTE FROM THE TEAM\n${reason}\n` : '';
	return `An honest update — for ${name}.

Thank you for writing — and for the trust it took.

After review, we're not able to offer you membership at this time.
${reasonBlock}
THIS ISN'T FINAL — You're welcome to reapply after 6 months.

If you'd like to ask anything, write to us at info@ecohubs.community.
Discord: ${discordUrl}
The Blueprint: https://blueprint.ecohubs.community

— The EcoHubs community
`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
