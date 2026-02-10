import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { sendEmail } from '$lib/email';
import { createAuthentikInvitation } from '$lib/server/authentik';
import { getProposalStatus, getMembershipVotingResult } from '$lib/server/blog-snapshot';
import { apiLogger } from '$lib/server/logger';

// POST - Send confirmation email with Authentik enrollment invitation
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (locals.user.safeOwnerStatus !== 'executed') {
		error(403, 'Only Safe owners can send confirmation emails');
	}

	const { id } = params;

	try {
		// Load the application
		const [application] = await db.select().from(applications).where(eq(applications.id, id));

		if (!application) {
			error(404, 'Application not found');
		}

		if (!application.snapshotProposalId) {
			error(400, 'Application does not have a Snapshot proposal');
		}

		if (application.confirmationEmailSentAt) {
			error(400, 'Confirmation email has already been sent');
		}

		// Verify the proposal is closed and approved on Snapshot
		const proposalStatus = await getProposalStatus(application.snapshotProposalId);
		if (!proposalStatus) {
			error(400, 'Unable to verify proposal status on Snapshot');
		}

		if (proposalStatus.status !== 'closed') {
			error(400, 'Voting has not ended yet');
		}

		const votingResult = getMembershipVotingResult(proposalStatus);
		if (votingResult !== 'approved') {
			error(400, `Application was not approved (result: ${votingResult || 'unknown'})`);
		}

		// Create Authentik enrollment invitation
		const { enrollmentUrl } = await createAuthentikInvitation(
			application.fullName,
			application.email
		);

		// Build the welcome email
		const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
		const emailHtml = buildWelcomeEmail(application.fullName, enrollmentUrl, appUrl);
		const emailText = buildWelcomeEmailText(application.fullName, enrollmentUrl, appUrl);

		// Send the email
		await sendEmail({
			to: application.email,
			subject: 'Welcome to EcoHubs Community — Your Membership is Approved!',
			html: emailHtml,
			text: emailText
		});

		// Update application with confirmation timestamp
		const sentAt = new Date().toISOString();
		await db
			.update(applications)
			.set({ confirmationEmailSentAt: sentAt })
			.where(eq(applications.id, id));

		apiLogger.info(
			{ applicationId: id, email: application.email },
			'Confirmation email sent successfully'
		);

		return json({ success: true, sentAt });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		apiLogger.error({ err, applicationId: id }, 'Error sending confirmation email');
		error(500, 'Failed to send confirmation email');
	}
};

function buildWelcomeEmail(name: string, enrollmentUrl: string, appUrl: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to EcoHubs Community</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1729;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f1729;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#0f1729;font-size:28px;font-weight:700;">EcoHubs Community</h1>
<p style="margin:8px 0 0;color:#0f1729;font-size:14px;opacity:0.8;">Regenerative Community Operating System</p>
</td></tr>

<!-- Body -->
<tr><td style="background-color:#1a2332;padding:40px;border-left:1px solid rgba(255,255,255,0.1);border-right:1px solid rgba(255,255,255,0.1);">

<h2 style="margin:0 0 16px;color:#f5f5f5;font-size:22px;">Welcome, ${name}!</h2>
<p style="margin:0 0 24px;color:#c4c9d4;font-size:15px;line-height:1.6;">
Congratulations! Your membership application has been reviewed and approved by the community. We're excited to have you join EcoHubs.
</p>

<!-- CTA Button -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:8px 0 32px;">
<a href="${enrollmentUrl}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0f1729;text-decoration:none;font-weight:700;font-size:16px;padding:14px 32px;border-radius:10px;">
Create Your Account
</a>
</td></tr>
</table>

<p style="margin:0 0 24px;color:#c4c9d4;font-size:15px;line-height:1.6;">
Use the button above to create your account. This is a one-time link that will guide you through the enrollment process.
</p>

<!-- Getting Started Section -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:24px;">
<tr><td style="padding:24px;">
<h3 style="margin:0 0 12px;color:#f5f5f5;font-size:16px;">Getting Started</h3>
<p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6;">
After creating your account, please complete all onboarding steps in the EcoHubs OS:
</p>
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="padding:4px 0;color:#c4c9d4;font-size:14px;">1. Log in to <a href="${appUrl}" style="color:#f59e0b;text-decoration:none;">EcoHubs OS</a></td></tr>
<tr><td style="padding:4px 0;color:#c4c9d4;font-size:14px;">2. Connect your wallet and complete the onboarding steps</td></tr>
<tr><td style="padding:4px 0;color:#c4c9d4;font-size:14px;">3. Introduce yourself and join our community spaces</td></tr>
</table>
</td></tr>
</table>

<!-- RCOS Section -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:24px;">
<tr><td style="padding:24px;">
<h3 style="margin:0 0 8px;color:#f5f5f5;font-size:16px;">Learn About RCOS</h3>
<p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6;">
EcoHubs is built on the Regenerative Community Operating System (RCOS). Learn about our principles and how we operate:
</p>
<a href="https://blueprint.ecohubs.community/articles/rcos-core" style="color:#f59e0b;text-decoration:none;font-size:14px;font-weight:600;">Read about RCOS &rarr;</a>
</td></tr>
</table>

</td></tr>

<!-- Social Links Footer -->
<tr><td style="background-color:#151d2d;padding:24px 40px;border-left:1px solid rgba(255,255,255,0.1);border-right:1px solid rgba(255,255,255,0.1);">
<p style="margin:0 0 12px;color:#8892a4;font-size:13px;text-align:center;">Connect with us</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<a href="https://mastodon.social/@ecohubs" style="color:#f59e0b;text-decoration:none;font-size:13px;margin:0 8px;">Mastodon</a>
<span style="color:#3a4556;">&middot;</span>
<a href="https://farcaster.xyz/ecohubs" style="color:#f59e0b;text-decoration:none;font-size:13px;margin:0 8px;">Farcaster</a>
<span style="color:#3a4556;">&middot;</span>
<a href="https://x.com/eco_hubs" style="color:#f59e0b;text-decoration:none;font-size:13px;margin:0 8px;">X</a>
<span style="color:#3a4556;">&middot;</span>
<a href="https://www.instagram.com/ecohubs_community" style="color:#f59e0b;text-decoration:none;font-size:13px;margin:0 8px;">Instagram</a>
</td></tr>
</table>
</td></tr>

<!-- Footer -->
<tr><td style="background-color:#111827;padding:20px 40px;border-radius:0 0 16px 16px;border-left:1px solid rgba(255,255,255,0.1);border-right:1px solid rgba(255,255,255,0.1);border-bottom:1px solid rgba(255,255,255,0.1);">
<p style="margin:0;color:#5a6478;font-size:12px;text-align:center;line-height:1.5;">
This invitation link is for single use only and will expire in 30 days.<br>
&copy; EcoHubs Community
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildWelcomeEmailText(name: string, enrollmentUrl: string, appUrl: string): string {
	return `Welcome to EcoHubs Community, ${name}!

Congratulations! Your membership application has been reviewed and approved by the community. We're excited to have you join EcoHubs.

CREATE YOUR ACCOUNT
${enrollmentUrl}

Use the link above to create your account. This is a one-time link that will guide you through the enrollment process.

GETTING STARTED
After creating your account, please complete all onboarding steps:
1. Log in to EcoHubs OS: ${appUrl}
2. Connect your wallet and complete the onboarding steps
3. Introduce yourself and join our community spaces

LEARN ABOUT RCOS
EcoHubs is built on the Regenerative Community Operating System (RCOS). Learn about our principles:
https://blueprint.ecohubs.community/articles/rcos-core

CONNECT WITH US
- Mastodon: https://mastodon.social/@ecohubs
- Farcaster: https://farcaster.xyz/ecohubs
- X: https://x.com/eco_hubs
- Instagram: https://www.instagram.com/ecohubs_community

This invitation link is for single use only and will expire in 30 days.
EcoHubs Community`;
}
