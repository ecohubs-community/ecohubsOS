import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { sendEmail } from '$lib/email';
import { createAuthentikInvitation } from '$lib/server/authentik';
import { materialiseProposal } from '$lib/server/voting/materialise';
import { apiLogger, authentikLogger, emailLogger } from '$lib/server/logger';
import { sendDiscordMessage } from '$lib/server/discord';
import { confirmationSentMessage } from '$lib/server/discord-templates';
import { subscribeToNewsletter } from '$lib/server/listmonk';

// POST - Send confirmation email with Authentik enrollment invitation
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (locals.user.safeOwnerStatus !== 'executed') {
		error(403, 'Only Safe owners can send confirmation emails');
	}

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

	if (application.confirmationEmailSentAt) {
		error(400, 'Confirmation email has already been sent');
	}

	apiLogger.info(
		{ applicationId: id, email: application.email, fullName: application.fullName },
		'Starting confirmation email flow'
	);

	// Step 1: Verify the linked local proposal closed with an approval.
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
	if (proposal.result !== 'approved') {
		error(400, `Application was not approved (result: ${proposal.result || 'unknown'})`);
	}

	apiLogger.info({ applicationId: id }, '[Step 1/4] Voting proposal verified: closed & approved');

	// Step 2: Create Authentik enrollment invitation
	let enrollmentUrl: string;
	try {
		const result = await createAuthentikInvitation(
			application.fullName,
			application.email
		);
		enrollmentUrl = result.enrollmentUrl;
	} catch (authentikErr) {
		authentikLogger.error(
			{
				err: authentikErr,
				applicationId: id,
				email: application.email,
				message: authentikErr instanceof Error ? authentikErr.message : String(authentikErr)
			},
			'[Step 2/4] Failed to create Authentik enrollment invitation'
		);
		error(500, `Failed to create Authentik invitation: ${authentikErr instanceof Error ? authentikErr.message : 'Unknown error'}`);
	}

	apiLogger.info({ applicationId: id }, '[Step 2/4] Authentik invitation created');

	// Step 3: Build and send the welcome email
	const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
	const emailHtml = buildWelcomeEmail(application.fullName, enrollmentUrl, appUrl);
	const emailText = buildWelcomeEmailText(application.fullName, enrollmentUrl, appUrl);

	try {
		await sendEmail({
			to: application.email,
			subject: 'Welcome to EcoHubs Community — Your Membership is Approved!',
			html: emailHtml,
			text: emailText
		});
	} catch (emailErr) {
		emailLogger.error(
			{ err: emailErr, applicationId: id, to: application.email },
			'[Step 3/4] Failed to send welcome email'
		);
		error(500, `Failed to send welcome email: ${emailErr instanceof Error ? emailErr.message : 'Unknown error'}`);
	}

	apiLogger.info({ applicationId: id }, '[Step 3/4] Welcome email sent');

	// Newsletter subscription (fire-and-forget)
	subscribeToNewsletter(application.fullName, application.email);

	// Discord notification (fire-and-forget)
	let location = 'unknown location';
	try {
		const formData = JSON.parse(application.formData);
		if (formData.location) location = formData.location;
	} catch { /* formData parse failure is non-critical */ }

	sendDiscordMessage({
		content: confirmationSentMessage({ fullName: application.fullName, location })
	});

	// Step 4: Update application with confirmation timestamp
	try {
		const sentAt = new Date().toISOString();
		await db
			.update(applications)
			.set({ confirmationEmailSentAt: sentAt })
			.where(eq(applications.id, id));

		apiLogger.info(
			{ applicationId: id, email: application.email },
			'[Step 4/4] Confirmation flow completed successfully'
		);

		return json({ success: true, sentAt });
	} catch (dbErr) {
		apiLogger.error(
			{ err: dbErr, applicationId: id },
			'[Step 4/4] Failed to update confirmation timestamp in database'
		);
		error(500, 'Email sent but failed to update database record');
	}
};

const FONT_INTER = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const FONT_PRIDI = `'Pridi', Georgia, 'Times New Roman', serif`;
const FONT_FRAUNCES = `'Fraunces', Georgia, 'Times New Roman', serif`;

function buildWelcomeEmail(name: string, enrollmentUrl: string, appUrl: string): string {
	const logoUrl = `${appUrl}/logo-symbol.png`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to EcoHubs</title>
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet">
<style>
	body { margin:0; padding:0; background:#fbfbf9; }
	a { color:#064e3b; }
	@media (max-width: 640px) {
		.container { width:100% !important; border-radius:0 !important; }
		.px { padding-left:24px !important; padding-right:24px !important; }
		.hero-h1 { font-size:36px !important; line-height:1.06 !important; }
		.cards td { display:block !important; width:100% !important; padding:6px 0 !important; }
	}
</style>
</head>
<body style="margin:0;padding:0;background:#fbfbf9;font-family:${FONT_INTER};color:#1c1917;-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Welcome to EcoHubs, ${name} — your membership is approved.</div>

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
							Membership approved
						</td>
					</tr>
				</table>
			</td></tr>

			<!-- Hero -->
			<tr><td style="background:#f5f2ea;padding:56px 40px 48px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin:0 0 22px 0;">
					Welcome home
				</div>
				<div class="hero-h1" style="font-family:${FONT_PRIDI};font-size:46px;line-height:1.04;color:#0b2e24;font-weight:500;letter-spacing:-0.01em;margin:0 0 22px 0;">
					You're in, ${name}.<br>
					<em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#059669;">The community said yes.</em>
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:18px;line-height:1.6;color:#1c1917;max-width:480px;">
					Your application was reviewed and approved by the members. We're glad you're joining us — and there's a small ritual to begin: setting up your account.
				</div>

				<!-- Primary CTA -->
				<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
					<tr><td>
						<a href="${enrollmentUrl}" style="display:inline-block;font-family:${FONT_INTER};font-size:15px;font-weight:500;color:#ffffff;background:#0b2e24;text-decoration:none;padding:16px 32px;border-radius:999px;">
							Create your account →
						</a>
					</td></tr>
				</table>
				<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:13px;color:#6b7265;margin-top:14px;">
					One-time link · expires in 30 days
				</div>
			</td></tr>

			<!-- What happens next -->
			<tr><td style="background:#fbfbf9;padding:48px 40px 16px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:12px;">
					What happens next
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:28px;line-height:1.2;color:#0b2e24;font-weight:500;margin-bottom:28px;">
					A few small steps, <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">in your own time.</em>
				</div>

				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
					<tr><td style="padding:0;">
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
							<tr>
								<td width="56" valign="top" style="padding:0 16px 0 0;text-align:center;position:relative;">
									<div style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:999px;background:#059669;border:1px solid #059669;font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;font-weight:500;color:#ffffff;">01</div>
									<div style="width:1px;height:48px;background:#e7e2d4;margin:6px auto 0 auto;line-height:1px;font-size:0;">&nbsp;</div>
								</td>
								<td valign="top" style="padding:6px 0 24px 0;">
									<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.3;margin-bottom:6px;">You're already in as a Supporter</div>
									<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;">We've given you Supporter access right away — to the Blueprint, public material, and our public conversations. See below for ways to get involved while you complete your enrollment.</div>
								</td>
							</tr>
						</table>
					</td></tr>
					<tr><td style="padding:0;">
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
							<tr>
								<td width="56" valign="top" style="padding:0 16px 0 0;text-align:center;position:relative;">
									<div style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:999px;background:#f5f2ea;border:1px solid #e7e2d4;font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;font-weight:500;color:#064e3b;">02</div>
									<div style="width:1px;height:48px;background:#e7e2d4;margin:6px auto 0 auto;line-height:1px;font-size:0;">&nbsp;</div>
								</td>
								<td valign="top" style="padding:6px 0 24px 0;">
									<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.3;margin-bottom:6px;">Create your member account</div>
									<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-bottom:14px;">Use the link below to enroll. It's a one-time link that walks you through the steps.</div>
									<a href="${enrollmentUrl}" style="display:inline-block;font-family:${FONT_INTER};font-size:14px;font-weight:500;color:#ffffff;background:#0b2e24;text-decoration:none;padding:12px 22px;border-radius:999px;">Create your account →</a>
								</td>
							</tr>
						</table>
					</td></tr>
					<tr><td style="padding:0;">
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
							<tr>
								<td width="56" valign="top" style="padding:0 16px 0 0;text-align:center;position:relative;">
									<div style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:999px;background:#f5f2ea;border:1px solid #e7e2d4;font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;font-weight:500;color:#064e3b;">03</div>
								</td>
								<td valign="top" style="padding:6px 0 0 0;">
									<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.3;margin-bottom:6px;">Settle in & join the rhythm</div>
									<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;">A short onboarding inside EcoHubs OS — set up your profile and connect the tools we use day to day. From there you'll be invited to weekly community meetings and the members-only newsletter.</div>
								</td>
							</tr>
						</table>
					</td></tr>
				</table>
			</td></tr>

			<!-- Hairline -->
			<tr><td style="background:#fbfbf9;padding:8px 40px 0 40px;" class="px">
				<div style="height:1px;background:linear-gradient(90deg, transparent, #064e3b30, transparent);margin:24px 0 28px 0;line-height:1px;font-size:0;">&nbsp;</div>
			</td></tr>

			<!-- Start now CTA -->
			<tr><td style="background:#fbfbf9;padding:0 40px 16px 40px;" class="px">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f2ea;border:1px solid #e7e2d4;border-radius:14px;">
					<tr><td style="padding:28px 28px;text-align:center;">
						<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:10px;">Don't lose the thread</div>
						<div style="font-family:${FONT_PRIDI};font-size:22px;line-height:1.3;color:#0b2e24;font-weight:500;margin-bottom:18px;">
							Start now and <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">create your account.</em>
						</div>
						<a href="${enrollmentUrl}" style="display:inline-block;font-family:${FONT_INTER};font-size:15px;font-weight:500;color:#ffffff;background:#0b2e24;text-decoration:none;padding:14px 28px;border-radius:999px;">Create your account →</a>
					</td></tr>
				</table>
			</td></tr>

			<!-- Hairline -->
			<tr><td style="background:#fbfbf9;padding:8px 40px 0 40px;" class="px">
				<div style="height:1px;background:linear-gradient(90deg, transparent, #064e3b30, transparent);margin:24px 0 28px 0;line-height:1px;font-size:0;">&nbsp;</div>
			</td></tr>

			<!-- Supporter offerings -->
			<tr><td style="background:#fbfbf9;padding:0 40px 16px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:12px;">
					Check out these supporter offerings
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:24px;line-height:1.22;color:#0b2e24;font-weight:500;margin-bottom:22px;">
					A few doors that are <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">already open to you.</em>
				</div>

				<table role="presentation" class="cards" width="100%" cellpadding="0" cellspacing="0" border="0">
					<tr>
						<td valign="top" width="50%" style="padding:6px 8px 6px 0;">
							<a href="https://blueprint.ecohubs.community/articles/rcos-core" style="display:block;background:#f5f2ea;border:1px solid #e7e2d4;border-radius:14px;padding:18px 20px;text-decoration:none;">
								<div style="font-family:${FONT_INTER};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7265;font-weight:600;margin-bottom:6px;">RCOS Blueprint</div>
								<div style="font-family:${FONT_PRIDI};font-size:17px;color:#0b2e24;font-weight:500;line-height:1.3;">Read the open-source guidebook <span style="color:#059669;">→</span></div>
							</a>
						</td>
						<td valign="top" width="50%" style="padding:6px 0 6px 8px;">
							<a href="${appUrl}" style="display:block;background:#f5f2ea;border:1px solid #e7e2d4;border-radius:14px;padding:18px 20px;text-decoration:none;">
								<div style="font-family:${FONT_INTER};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#6b7265;font-weight:600;margin-bottom:6px;">EcoHubs OS</div>
								<div style="font-family:${FONT_PRIDI};font-size:17px;color:#0b2e24;font-weight:500;line-height:1.3;">Sign in once your account is set up <span style="color:#059669;">→</span></div>
							</a>
						</td>
					</tr>
				</table>
			</td></tr>

			<!-- Hairline -->
			<tr><td style="background:#fbfbf9;padding:8px 40px 0 40px;" class="px">
				<div style="height:1px;background:linear-gradient(90deg, transparent, #064e3b30, transparent);margin:24px 0 28px 0;line-height:1px;font-size:0;">&nbsp;</div>
			</td></tr>

			<!-- Spread the word -->
			<tr><td style="background:#fbfbf9;padding:0 40px 16px 40px;" class="px">
				<div style="font-family:${FONT_INTER};font-size:10.5px;letter-spacing:0.22em;text-transform:uppercase;font-weight:600;color:#059669;margin-bottom:12px;">
					Spread the word
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:24px;line-height:1.22;color:#0b2e24;font-weight:500;margin-bottom:8px;">
					If this resonates, <em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#6b7265;">help us reach the next person.</em>
				</div>
				<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-bottom:22px;">
					There are two easy ways to share EcoHubs with someone who might belong here too.
				</div>

				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
					<tr><td style="padding:0;">
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
							<tr>
								<td width="56" valign="top" style="padding:0 16px 0 0;text-align:center;">
									<div style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:999px;background:#f5f2ea;border:1px solid #e7e2d4;font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;font-weight:500;color:#064e3b;">01</div>
								</td>
								<td valign="top" style="padding:6px 0 18px 0;">
									<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.3;margin-bottom:6px;">Recommend to a friend</div>
									<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-bottom:14px;">A pre-written email — open it in your mail app, add who you're sending to, and adjust as you like.</div>
									<a href="mailto:?subject=Something%20I%20think%20you'd%20want%20to%20see%20%E2%80%94%20EcoHubs&body=Hi%2C%0A%0AI%20just%20joined%20EcoHubs%20%E2%80%94%20a%20community%20co-creating%20a%20regenerative%20way%20of%20life%2C%20one%20hub%20at%20a%20time.%0A%0AThey're%20building%20this%20in%20the%20open%3A%20an%20open-source%20guidebook%20(the%20RCOS%20Blueprint)%2C%20a%20software%20platform%20(EcoHubs%20OS)%2C%20and%20a%20real%20network%20of%20people%20doing%20the%20work.%0A%0AThought%20of%20you.%20Have%20a%20look%3A%0Ahttps%3A%2F%2Fecohubs.community%0A%0AWarmly%2C" style="display:inline-block;font-family:${FONT_INTER};font-size:14px;font-weight:500;color:#ffffff;background:#0b2e24;text-decoration:none;padding:12px 22px;border-radius:999px;">Open in your mail app →</a>
								</td>
							</tr>
						</table>
					</td></tr>

					<tr><td style="padding:0;">
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
							<tr>
								<td width="56" valign="top" style="padding:0 16px 0 0;text-align:center;">
									<div style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:999px;background:#f5f2ea;border:1px solid #e7e2d4;font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;font-weight:500;color:#064e3b;">02</div>
								</td>
								<td valign="top" style="padding:6px 0 0 0;">
									<div style="font-family:${FONT_PRIDI};font-size:18px;color:#0b2e24;font-weight:500;line-height:1.3;margin-bottom:6px;">Share on social</div>
									<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;margin-bottom:12px;">Repost or link to us — every signal helps the right people find their way in.</div>
									<div style="font-family:${FONT_INTER};font-size:14px;color:#1c1917;line-height:2;">
										<a href="https://mastodon.social/@ecohubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">Mastodon</a>
										<a href="https://farcaster.xyz/ecohubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">Farcaster</a>
										<a href="https://x.com/eco_hubs" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">X</a>
										<a href="https://www.instagram.com/ecohubs_community" style="color:#064e3b;text-decoration:none;margin-right:14px;border-bottom:1px solid #064e3b40;">Instagram</a>
										<a href="https://github.com/ecohubs-community" style="color:#064e3b;text-decoration:none;border-bottom:1px solid #064e3b40;">GitHub</a>
									</div>
								</td>
							</tr>
						</table>
					</td></tr>
				</table>
			</td></tr>

			<!-- Hairline -->
			<tr><td style="background:#fbfbf9;padding:8px 40px 0 40px;" class="px">
				<div style="height:1px;background:linear-gradient(90deg, transparent, #064e3b30, transparent);margin:24px 0 28px 0;line-height:1px;font-size:0;">&nbsp;</div>
			</td></tr>

			<!-- Contact -->
			<tr><td style="background:#fbfbf9;padding:0 40px 16px 40px;" class="px">
				<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.6;color:#1c1917;">
					Questions about membership, the Blueprint, or technical issues? Write to us at <a href="mailto:info@ecohubs.community" style="color:#064e3b;text-decoration:none;border-bottom:1px solid #064e3b40;">info@ecohubs.community</a> — a person reads every message.
				</div>
			</td></tr>

			<!-- Manifesto closer -->
			<tr><td style="padding:32px 40px 40px 40px;" class="px">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b2e24;border-radius:18px;">
					<tr><td style="padding:44px 36px;text-align:center;">
						<div style="font-family:${FONT_PRIDI};font-size:24px;line-height:1.3;color:#f5f2ea;font-weight:500;margin-bottom:6px;">
							<em style="font-family:${FONT_FRAUNCES};font-style:italic;font-weight:400;color:#9c9685;">The system does not provide —</em>
						</div>
						<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:28px;line-height:1.2;color:#a7f3d0;font-weight:500;margin-bottom:22px;">
							nature does.
						</div>
						<div style="width:48px;height:1px;background:#05966980;margin:0 auto 22px auto;line-height:1px;font-size:0;">&nbsp;</div>
						<div style="font-family:${FONT_PRIDI};font-size:15px;line-height:1.65;color:#d4cfb8;max-width:420px;margin:0 auto;">
							We're glad you're here, ${name}. This is a living project — and it just got a little more alive because you said yes back.
						</div>
						<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:15px;color:#a7f3d0;margin-top:18px;">
							— Stefan, for the EcoHubs community
						</div>
					</td></tr>
				</table>
			</td></tr>

			<!-- Footer -->
			<tr><td style="background:#f5f2ea;padding:24px 40px;border-top:1px solid #e7e2d4;text-align:center;" class="px">
				<div style="font-family:${FONT_FRAUNCES};font-style:italic;font-size:13px;color:#6b7265;line-height:1.6;">
					Your enrollment link is single-use and expires in 30 days. <br>
					EcoHubs · Co-creating a regenerative way of life, one hub at a time.
				</div>
			</td></tr>

		</table>

	</td></tr>
</table>

</body>
</html>`;
}

function buildWelcomeEmailText(name: string, enrollmentUrl: string, appUrl: string): string {
	return `Welcome home — you're in, ${name}.
The community said yes.

Your application was reviewed and approved by the members. We're glad you're joining us — and there's a small ritual to begin: setting up your account.

CREATE YOUR ACCOUNT
${enrollmentUrl}
(One-time link · expires in 30 days)

WHAT HAPPENS NEXT — A few small steps, in your own time.

01 · You're already in as a Supporter
   We've given you Supporter access right away — to the Blueprint, public material, and our public conversations. See below for ways to get involved while you complete your enrollment.

02 · Create your member account
   Use the link below to enroll. It's a one-time link that walks you through the steps.
   ${enrollmentUrl}

03 · Settle in & join the rhythm
   A short onboarding inside EcoHubs OS — set up your profile and connect the tools we use day to day. From there you'll be invited to weekly community meetings and the members-only newsletter.

----------------------------------------------------------------
DON'T LOSE THE THREAD — Start now and create your account:
${enrollmentUrl}
----------------------------------------------------------------

CHECK OUT THESE SUPPORTER OFFERINGS — A few doors that are already open to you.

· RCOS Blueprint — read the open-source guidebook:
  https://blueprint.ecohubs.community/articles/rcos-core
· EcoHubs OS — sign in once your account is set up:
  ${appUrl}

SPREAD THE WORD — If this resonates, help us reach the next person.

· Recommend to a friend — open a pre-written email in your mail app and adjust as you like.
· Share on social:
  Mastodon:  https://mastodon.social/@ecohubs
  Farcaster: https://farcaster.xyz/ecohubs
  X:         https://x.com/eco_hubs
  Instagram: https://www.instagram.com/ecohubs_community
  GitHub:    https://github.com/ecohubs-community

Questions about membership, the Blueprint, or technical issues? Write to us at info@ecohubs.community — a person reads every message.

----------------------------------------------------------------

The system does not provide — nature does.

We're glad you're here, ${name}. This is a living project — and it just got a little more alive because you said yes back.

— Stefan, for the EcoHubs community

Your enrollment link is single-use and expires in 30 days.
EcoHubs · Co-creating a regenerative way of life, one hub at a time.
`;
}
