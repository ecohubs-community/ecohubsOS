import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { sendEmail } from '$lib/email';
import { getProposalStatus, getMembershipVotingResult } from '$lib/server/blog-snapshot';
import { apiLogger, emailLogger } from '$lib/server/logger';

// POST - Send rejection email to applicant
export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	if (locals.user.safeOwnerStatus !== 'executed') {
		error(403, 'Only Safe owners can send rejection emails');
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

	if (!application.snapshotProposalId) {
		error(400, 'Application does not have a Snapshot proposal');
	}

	if (application.rejectionEmailSentAt) {
		error(400, 'Rejection email has already been sent');
	}

	apiLogger.info(
		{ applicationId: id, email: application.email, fullName: application.fullName },
		'Starting rejection email flow'
	);

	// Step 1: Verify the proposal is closed and rejected on Snapshot
	let proposalStatus;
	try {
		proposalStatus = await getProposalStatus(application.snapshotProposalId);
	} catch (snapshotErr) {
		apiLogger.error(
			{ err: snapshotErr, applicationId: id, snapshotProposalId: application.snapshotProposalId },
			'[Step 1/3] Failed to fetch proposal status from Snapshot'
		);
		error(500, 'Failed to verify proposal status on Snapshot');
	}

	if (!proposalStatus) {
		error(400, 'Unable to verify proposal status on Snapshot');
	}

	if (proposalStatus.status !== 'closed') {
		error(400, 'Voting has not ended yet');
	}

	const votingResult = getMembershipVotingResult(proposalStatus);
	if (votingResult !== 'rejected') {
		error(400, `Application was not rejected (result: ${votingResult || 'unknown'})`);
	}

	apiLogger.info({ applicationId: id }, '[Step 1/3] Snapshot proposal verified: closed & rejected');

	// Step 2: Build and send the rejection email
	const discordInviteUrl = env.DISCORD_INVITE_URL || 'https://discord.gg/ecohubs';
	const emailHtml = buildRejectionEmail(application.fullName, discordInviteUrl);
	const emailText = buildRejectionEmailText(application.fullName, discordInviteUrl);

	try {
		await sendEmail({
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

	apiLogger.info({ applicationId: id }, '[Step 2/3] Rejection email sent');

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

function buildRejectionEmail(name: string, discordUrl: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EcoHubs Community — Application Update</title>
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

<h2 style="margin:0 0 16px;color:#f5f5f5;font-size:22px;">Dear ${name},</h2>
<p style="margin:0 0 20px;color:#c4c9d4;font-size:15px;line-height:1.6;">
Thank you for your interest in joining the EcoHubs Community and for taking the time to submit your membership application. We truly appreciate it.
</p>
<p style="margin:0 0 20px;color:#c4c9d4;font-size:15px;line-height:1.6;">
After careful consideration by our community members, we are not able to offer you membership at this time.
</p>
<p style="margin:0 0 24px;color:#c4c9d4;font-size:15px;line-height:1.6;">
Please know that this is not a final decision — <strong style="color:#f5f5f5;">you are welcome to reapply after 6 months</strong>. Communities evolve, and we encourage you to try again in the future.
</p>

<!-- Discord CTA -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:24px;">
<tr><td style="padding:24px;">
<h3 style="margin:0 0 12px;color:#f5f5f5;font-size:16px;">Stay Connected</h3>
<p style="margin:0 0 16px;color:#c4c9d4;font-size:14px;line-height:1.6;">
In the meantime, we'd love for you to join our public Discord community. It's a great way to get to know us, participate in conversations, and stay up to date with what we're building.
</p>
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td>
<a href="${discordUrl}" style="display:inline-block;background:linear-gradient(135deg,#5865F2,#4752C4);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 28px;border-radius:10px;">
Join Our Discord
</a>
</td></tr>
</table>
</td></tr>
</table>

<p style="margin:0;color:#c4c9d4;font-size:15px;line-height:1.6;">
We wish you all the best and hope to see you again soon.
</p>
<p style="margin:16px 0 0;color:#c4c9d4;font-size:15px;line-height:1.6;">
Warm regards,<br>
<strong style="color:#f5f5f5;">The EcoHubs Community</strong>
</p>

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
&copy; EcoHubs Community
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildRejectionEmailText(name: string, discordUrl: string): string {
	return `Dear ${name},

Thank you for your interest in joining the EcoHubs Community and for taking the time to submit your membership application. We truly appreciate it.

After careful consideration by our community members, we are not able to offer you membership at this time.

Please know that this is not a final decision — you are welcome to reapply after 6 months. Communities evolve, and we encourage you to try again in the future.

STAY CONNECTED
In the meantime, we'd love for you to join our public Discord community. It's a great way to get to know us, participate in conversations, and stay up to date with what we're building.

Join our Discord: ${discordUrl}

We wish you all the best and hope to see you again soon.

Warm regards,
The EcoHubs Community

CONNECT WITH US
- Mastodon: https://mastodon.social/@ecohubs
- Farcaster: https://farcaster.xyz/ecohubs
- X: https://x.com/eco_hubs
- Instagram: https://www.instagram.com/ecohubs_community

EcoHubs Community`;
}
