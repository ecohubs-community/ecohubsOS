// Email templates for the manual onboarding nudges (reminder + buddy call).
// Each builder returns a default SUBJECT and a plain-text BODY which the steward
// can freely edit in the composer before copying or sending. On "Send now" the
// (possibly edited) text is wrapped into a lightweight branded HTML shell via
// renderBrandedEmailHtml().

const FONT_INTER = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const FONT_PRIDI = `'Pridi', Georgia, 'Times New Roman', serif`;

export interface EmailTemplate {
	subject: string;
	body: string;
}

/** Reminder for members who were accepted but never created their account. */
export function buildReminderTemplate(opts: {
	recipientName: string;
	senderName: string;
	enrollmentUrl: string;
}): EmailTemplate {
	const { recipientName, senderName, enrollmentUrl } = opts;
	return {
		subject: 'Checking in — your EcoHubs account is waiting',
		body: `Hi ${recipientName},

A little while back your EcoHubs membership was approved and we sent you a link to set up your account — but it looks like you haven't had the chance to create it yet. No worries at all, life gets busy.

I wanted to check in personally and make sure the link reached you. Here's a fresh one (the earlier link may have expired):

${enrollmentUrl}

It's a one-time link and walks you through creating your account in a few minutes. Once you're in you'll have access to EcoHubs OS, our community tools, and an invitation to your buddy call.

If you ran into any trouble, or you're no longer able to join, just reply to this email and let me know — a real person reads every message.

Warmly,
${senderName}, EcoHubs community`
	};
}

/**
 * Buddy-call invitation. Uses the community-supplied copy. When a scheduling
 * link is provided we use the "book a slot" variant (OPTION 2); otherwise the
 * "propose times" variant (OPTION 1). Remaining bracketed placeholders
 * ([Your Discord], slot options, [Jitsi / Zoom / other]) are intentionally left
 * for the steward to fill in before sending.
 */
export function buildBuddyCallTemplate(opts: {
	recipientName: string;
	senderName: string;
	schedulingUrl?: string | null;
}): EmailTemplate {
	const { recipientName, senderName, schedulingUrl } = opts;

	const intro = `Hi ${recipientName},

Welcome to EcoHubs. I'm ${senderName} — one of the initiating members of the community — and I'll be your buddy for the first stretch of your onboarding.

A quick word on what that means. The buddy system pairs every new member with someone who's been in the community a while, so you have an actual person — not just a Discord channel — to bring questions to. There's no fixed script. We shape it around what you want to learn, what you're curious about, and where you might want to contribute.

I'd like to start with a 1:1 call. Nothing formal: we get to know each other, I share what's currently moving in the community, you share what brought you here and what you'd like to explore, and we look for places our interests overlap. From there we can decide what's useful next — a regular check-in, an introduction to someone working on a topic you care about, or just an open line whenever you need it.`;

	const withLink = `The easiest way to find a time is to grab a slot directly here:

${schedulingUrl}

I've blocked roughly 45 minutes per call, across a range of times so something should work for your timezone. The link generates a [Jitsi / Zoom / other] invite automatically once you book.

If none of the slots work or you'd prefer to coordinate by email, just reply and tell me your timezone — we'll find something.`;

	const withoutLink = `To find a time, could you let me know:

- Your timezone
- Which of these slots works for you (or propose your own):
    - [Option 1 — day, date, time + your timezone]
    - [Option 2 — day, date, time + your timezone]
    - [Option 3 — day, date, time + your timezone]

I'd block around 45 minutes. Once we lock in a slot I'll send a [Jitsi / Zoom / other] link.`;

	const middle = schedulingUrl ? withLink : withoutLink;

	const closing = `In the meantime — please write any time. You can reach me on this email or as [Your Discord] in Discord. No question is too small, and "I'm not sure what I'm supposed to be doing here yet" is a perfectly normal place to start.

Looking forward to meeting you,

${senderName}, EcoHubs community`;

	return {
		subject: "Welcome to EcoHubs — let's set up your buddy call",
		body: `${intro}\n\n${middle}\n\n${closing}`
	};
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Wrap a (possibly steward-edited) plain-text body into a lightweight branded
 * HTML email. URLs become links; blank lines become paragraph breaks.
 */
export function renderBrandedEmailHtml(bodyText: string): string {
	const paragraphs = bodyText.split(/\n{2,}/).map((para) => {
		const safe = escapeHtml(para)
			// Linkify bare URLs.
			.replace(
				/(https?:\/\/[^\s<]+)/g,
				'<a href="$1" style="color:#064e3b;">$1</a>'
			)
			// Preserve single line breaks within a paragraph.
			.replace(/\n/g, '<br>');
		return `<p style="margin:0 0 18px 0;font-family:${FONT_PRIDI};font-size:16px;line-height:1.6;color:#1c1917;">${safe}</p>`;
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Pridi:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fbfbf9;font-family:${FONT_INTER};color:#1c1917;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbfbf9;">
	<tr><td align="center" style="padding:32px 16px;">
		<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#fbfbf9;border:1px solid #e7e2d4;border-radius:18px;overflow:hidden;">
			<tr><td style="background:#0b2e24;padding:18px 32px;font-family:${FONT_PRIDI};font-size:16px;color:#f5f2ea;font-weight:500;">EcoHubs</td></tr>
			<tr><td style="padding:36px 32px;">${paragraphs.join('\n')}</td></tr>
			<tr><td style="background:#f5f2ea;padding:20px 32px;border-top:1px solid #e7e2d4;font-family:${FONT_INTER};font-size:12px;color:#6b7265;text-align:center;">EcoHubs · Co-creating a regenerative way of life, one hub at a time.</td></tr>
		</table>
	</td></tr>
</table>
</body>
</html>`;
}
