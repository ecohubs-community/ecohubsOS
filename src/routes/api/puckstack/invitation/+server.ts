import { json, type RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { env } from '$env/dynamic/private';
import { puckstackLogger } from '$lib/server/logger';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

interface AutoGenerateAlreadyMemberResponse {
	success: true;
	alreadyMember: true;
	user: { id: string };
	workspace: { slug: string; name: string; url: string };
}

interface AutoGenerateInvitationResponse {
	success: true;
	invitation: { token: string; joinUrl: string; expiresAt: string; role: string };
}

interface InvitationRequestBody {
	inviteToken?: string;
}

type AutoGenerateResponse =
	| AutoGenerateAlreadyMemberResponse
	| AutoGenerateInvitationResponse
	| { success: false; error?: string };

function isAlreadyMember(data: AutoGenerateResponse): data is AutoGenerateAlreadyMemberResponse {
	return data.success === true && 'alreadyMember' in data && data.alreadyMember === true;
}

function isInvitation(data: AutoGenerateResponse): data is AutoGenerateInvitationResponse {
	return data.success === true && 'invitation' in data;
}

/**
 * Proxy endpoint to generate a Puckstack workspace invitation.
 * Also: when Puckstack reports the user is already a member, capture
 * their Puckstack User ID and persist it on the local user record so
 * the manual "copy your User ID" onboarding step can be skipped.
 */
export const POST: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const puckstackApiUrl = env.PUCKSTACK_API_URL;
	const puckstackApiKey = env.PUCKSTACK_API_KEY;

	if (!puckstackApiUrl || !puckstackApiKey) {
		puckstackLogger.error('PUCKSTACK_API_URL or PUCKSTACK_API_KEY not configured');
		return json({ success: false, error: 'Puckstack integration not configured' }, { status: 500 });
	}

	// Optional client-supplied inviteToken — overrides the DB value if
	// provided. Useful if a stored token went bad and the user has a
	// fresher one in hand.
	let body: InvitationRequestBody = {};
	try {
		body = (await request.json()) as InvitationRequestBody;
	} catch {
		// No body / malformed body — proceed with stored token (if any).
	}
	const clientToken = typeof body.inviteToken === 'string' ? body.inviteToken : undefined;

	// Pull the persisted invitation token from the user record so we
	// survive component remounts, browser restarts, and device switches.
	const [dbUser] = await db
		.select({ puckstackInviteToken: user.puckstackInviteToken })
		.from(user)
		.where(eq(user.id, session.user.id));
	const storedToken = dbUser?.puckstackInviteToken ?? undefined;

	const inviteToken = clientToken ?? storedToken;

	try {
		const response = await fetch(`${puckstackApiUrl}/invitations/auto-generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${puckstackApiKey}`
			},
			body: JSON.stringify({
				workspaceSlug: 'ecohubs',
				email: session.user.email,
				...(inviteToken ? { inviteToken } : {})
			})
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			puckstackLogger.error({ status: response.status, errorData }, 'Puckstack invitation API error');
			return json(
				{ success: false, error: errorData.error || 'Failed to generate invitation' },
				{ status: response.status }
			);
		}

		const data = (await response.json()) as AutoGenerateResponse;

		if (isAlreadyMember(data)) {
			// Persist the Puckstack User ID and clear the now-redundant
			// invite token so future calls don't keep retrying it.
			const puckstackUserId = data.user.id;
			try {
				await db
					.update(user)
					.set({
						puckstackUserId,
						puckstackInviteToken: null,
						updatedAt: new Date()
					})
					.where(eq(user.id, session.user.id));
			} catch (dbErr) {
				puckstackLogger.error(
					{ err: dbErr, userId: session.user.id, puckstackUserId },
					'Failed to persist puckstackUserId (non-fatal)'
				);
			}

			return json({
				success: true,
				alreadyMember: true,
				workspaceUrl: data.workspace.url,
				puckstackUserId
			});
		}

		if (isInvitation(data)) {
			// Persist the new (or refreshed) token so it survives across
			// sessions, devices, and component remounts.
			try {
				await db
					.update(user)
					.set({
						puckstackInviteToken: data.invitation.token,
						updatedAt: new Date()
					})
					.where(eq(user.id, session.user.id));
			} catch (dbErr) {
				puckstackLogger.error(
					{ err: dbErr, userId: session.user.id },
					'Failed to persist puckstackInviteToken (non-fatal)'
				);
			}

			return json({
				success: true,
				joinUrl: data.invitation.joinUrl,
				inviteToken: data.invitation.token,
				expiresAt: data.invitation.expiresAt
			});
		}

		puckstackLogger.error({ data }, 'Unexpected auto-generate response shape');
		return json(
			{ success: false, error: 'Unexpected response from Puckstack' },
			{ status: 502 }
		);
	} catch (err) {
		puckstackLogger.error({ err }, 'Failed to connect to Puckstack');
		return json({ success: false, error: 'Failed to connect to Puckstack' }, { status: 500 });
	}
};
