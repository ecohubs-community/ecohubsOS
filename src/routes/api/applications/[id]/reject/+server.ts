import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { sendEmail } from '$lib/email';
import { materialiseProposal } from '$lib/server/voting/materialise';
import { apiLogger, emailLogger } from '$lib/server/logger';
import { sendDiscordMessage } from '$lib/server/discord';
import { rejectionSentMessage } from '$lib/server/discord-templates';
import { requireAdmin } from '$lib/server/authz';

// POST - Send rejection email to applicant
export const POST: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);

	const { id } = params;

	// Load the application
	let application;
	try {
		const [row] = await db.select().from(applications).where(eq(applications.id, id));
		application = row;
	} catch (dbErr) {
		apiLogger.error({ err: dbErr, applicationId: id }, 'Database error loading application');
		error(500, 'Database error loading application');
	}

	if (!application) {
		error(404, 'Application not found');
	}

	if (application.rejectionEmailSentAt) {
		error(400, 'Rejection email has already been sent');
	}

	apiLogger.info(
		{ applicationId: id, email: application.email, fullName: application.fullName },
		'Starting rejection email flow'
	);

	// Step 1: Verify the linked local proposal closed with a rejection.
	const [linkedProposal] = await db
		.select()
		.from(proposals)
		.where(eq(proposals.linkedApplicationId, id));

	if (!linkedProposal) {
		error(400, 'Application does not have a voting proposal');
	}

	const proposal = await materialiseProposal(linkedProposal);
	const closedStatuses = ['closed', 'ratifying', 'ratified'] as const;
	if (!closedStatuses.includes(proposal.status as (typeof closedStatuses)[number])) {
		error(400, 'Voting has not ended yet');
	}
	// A 'tied' result is treated as rejected per the protocol (status quo holds).
	// 'needs_review' is admin-resolvable either way, so a reject is permitted here too.
	if (
		proposal.result !== 'rejected' &&
		proposal.result !== 'tied' &&
		proposal.result !== 'needs_review'
	) {
		error(400, `Application cannot be rejected (result: ${proposal.result || 'unknown'})`);
	}

	apiLogger.info({ applicationId: id }, '[Step 1/3] Voting proposal verified: closed & rejectable');

	// Step 2: Build and send the rejection email
	const discordInviteUrl = env.DISCORD_INVITE_URL || 'https://discord.gg/ecohubs';
	const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
	const emailHtml = buildRejectionEmail(application.fullName, discordInviteUrl, appUrl);
	const emailText = buildRejectionEmailText(application.fullName, discordInviteUrl);

	let emailResult;
	try {
		emailResult = await sendEmail({
			to: application.email,
			subject: 'EcoHubs Community — Update on Your Membership Application',
			html: emailHtml,
			text: emailText
		});
	} catch (emailErr) {
		emailLogger.error(
			{ err: emailErr, applicationId: id, to: application.email },
			'[Step 2/3] Failed to send rejection email'
		);
		error(500, `Failed to send rejection email: ${emailErr instanceof Error ? emailErr.message : 'Unknown error'}`);
	}

	apiLogger.info(
		{ applicationId: id, messageId: emailResult.messageId },
		'[Step 2/3] Rejection email sent'
	);

	// Discord notification (fire-and-forget)
	sendDiscordMessage({
		content: rejectionSentMessage({
			fullName: application.fullName
		})
	});

	// Step 3: Update application with rejection email timestamp
	try {
		const sentAt = new Date().toISOString();
		await db
			.update(applications)
			.set({ rejectionEmailSentAt: sentAt })
			.where(eq(applications.id, id));

		apiLogger.info(
			{ applicationId: id, email: application.email },
			'[Step 3/3] Rejection email flow completed successfully'
		);

		return json({ success: true, sentAt });
	} catch (dbErr) {
		apiLogger.error(
			{ err: dbErr, applicationId: id },
			'[Step 3/3] Failed to update rejection timestamp in database'
		);
		error(500, 'Email sent but failed to update database record');
	}
};

const FONT_INTER = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const FONT_PRIDI = `'Pridi', Georgia, 'Times New Roman', serif`;
const FONT_FRAUNCES = `'Fraunces', Georgia, 'Times New Roman', serif`;

function buildRejectionEmail(name: string, discordUrl: string, appUrl: string): string {
	const logoUrl = `${appUrl}/logo-symbol.png`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>An update on your EcoHubs application</title>
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet">
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

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A note about your EcoHubs application — and a door that stays open.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbfbf9;">
	<tr><td align="center" style="padding:32px 16px;">

		<table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#fbfbf9;border:1px solid #e7e2d4;border-radius:18px;overflow:hidden;">

			<!-- Masthead -->
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

			<!-- Hero -->
			<tr><td style="background:#f5f2ea;padding:56px 40px 48px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin:0 0 22px 0;">
					An honest update
				</div>
				<div class="hero-h1" style="font-family:${FONT_PRIDI};font-size:42px;line-height:1.06;color:#0b2e24;font-weight:500;letter-spacing:-0.01em;margin:0 0 22px 0;">
					Thank you for writing, ${name}.<br>
					<em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">— and for the trust it took.</em>
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:18px;line-height:1.6;color:#1c1917;max-width:480px;">
					Your application was read with care by members of the community. After honest discussion, we're not able to offer you membership at this time.
				</div>
			</td></tr>

			<!-- Body -->
			<tr><td style="background:#fbfbf9;padding:40px 40px 16px 40px;" class="px">

				<div style="font-family:${FONT_PRIDI};font-size:17px;line-height:1.7;color:#1c1917;margin-bottom:20px;">
					Membership decisions are not a measure of your worth or your work. They reflect what this particular community needs <em style="font-family:${FONT_FRAUNCES};font-style:italic;">at this particular moment</em> — and a community is a small, slow, fragile thing. We try to choose carefully, knowing we'll sometimes get it wrong.
				</div>

				<!-- Reapply note -->
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

				<!-- Stay connected -->
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:12px;">
					Stay close, if you'd like
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:24px;line-height:1.22;color:#0b2e24;font-weight:500;margin-bottom:22px;">
					The Blueprint and the public space <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">are still yours.</em>
				</div>

				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
					<tr>
						<td valign="top" width="50%" style="padding:6px 8px 6px 0;">
							<a href="${discordUrl}" style="display:block;background:#f5f2ea;border:1px solid #e7e2d4;border-radius:14px;padding:18px 20px;text-decoration:none;">
								<div style="font-family:${FONT_INTER};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7265;font-weight:600;margin-bottom:6px;">Discord</div>
								<div style="font-family:${FONT_PRIDI};font-size:17px;color:#0b2e24;font-weight:500;line-height:1.3;">Join the public conversation <span style="color:#059669;">→</span></div>
							</a>
						</td>
						<td valign="top" width="50%" style="padding:6px 0 6px 8px;">
							<a href="https://blueprint.ecohubs.community" style="display:block;background:#f5f2ea;border:1px solid #e7e2d4;border-radius:14px;padding:18px 20px;text-decoration:none;">
								<div style="font-family:${FONT_INTER};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7265;font-weight:600;margin-bottom:6px;">The Blueprint</div>
								<div style="font-family:${FONT_PRIDI};font-size:17px;color:#0b2e24;font-weight:500;line-height:1.3;">Read & comment on the open work <span style="color:#059669;">→</span></div>
							</a>
						</td>
					</tr>
				</table>

				<!-- Follow + contact -->
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin:32px 0 12px 0;">
					Follow us for updates
				</div>
				<div style="font-family:${FONT_INTER};font-size:14px;color:#1c1917;line-height:2;">
					<a href="https://mastodon.social/@ecohubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">Mastodon</a>
					<a href="https://farcaster.xyz/ecohubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">Farcaster</a>
					<a href="https://x.com/eco_hubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">X</a>
					<a href="https://www.instagram.com/ecohubs_community" style="color:#064e3b;text-decoration:none;border-bottom:1px solid #064e3b40;">Instagram</a>
				</div>

				<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-top:24px;">
					If you'd like to ask anything — about the decision, the Blueprint, or membership in the future — write to us at <a href="mailto:info@ecohubs.community" style="color:#064e3b;text-decoration:none;border-bottom:1px solid #064e3b40;">info@ecohubs.community</a>. A person reads every message.
				</div>

			</td></tr>

			<!-- Closing -->
			<tr><td style="padding:24px 40px 40px 40px;" class="px">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b2e24;border-radius:18px;">
					<tr><td style="padding:40px 36px;text-align:center;">
						<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:22px;line-height:1.3;color:#a7f3d0;font-weight:500;margin-bottom:18px;">
							We wish you well — really.
						</div>
						<div style="width:48px;height:1px;background:#05966980;margin:0 auto 22px auto;line-height:1px;font-size:0;">&nbsp;</div>
						<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.65;color:#d4cfb8;max-width:420px;margin:0 auto;">
							Thank you for caring enough to apply. The world needs more people who do.
						</div>
						<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;color:#a7f3d0;margin-top:18px;">
							— The EcoHubs community
						</div>
					</td></tr>
				</table>
			</td></tr>

			<!-- Footer -->
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

function buildRejectionEmailText(name: string, discordUrl: string): string {
	return `An honest update — for ${name}.

Thank you for writing — and for the trust it took.

Your application was read with care by members of the community. After honest discussion, we're not able to offer you membership at this time.

Membership decisions are not a measure of your worth or your work. They reflect what this particular community needs at this particular moment — and a community is a small, slow, fragile thing. We try to choose carefully, knowing we'll sometimes get it wrong.

THIS ISN'T FINAL — You're welcome to reapply after 6 months.
People change. Communities change. We'd genuinely be glad to read a new application from you when the season feels right.

STAY CLOSE, IF YOU'D LIKE — The Blueprint and the public space are still yours.

· Discord — join the public conversation: ${discordUrl}
· The Blueprint — read & comment on the open work: https://blueprint.ecohubs.community

FOLLOW US FOR UPDATES
  Mastodon:  https://mastodon.social/@ecohubs
  Farcaster: https://farcaster.xyz/ecohubs
  X:         https://x.com/eco_hubs
  Instagram: https://www.instagram.com/ecohubs_community

If you'd like to ask anything — about the decision, the Blueprint, or membership in the future — write to us at info@ecohubs.community. A person reads every message.

----------------------------------------------------------------

We wish you well — really.

Thank you for caring enough to apply. The world needs more people who do.

— The EcoHubs community

EcoHubs · Co-creating a regenerative way of life, one hub at a time.
`;
}
