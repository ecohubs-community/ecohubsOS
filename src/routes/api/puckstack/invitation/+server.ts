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

	try {
		const response = await fetch(`${puckstackApiUrl}/invitations/auto-generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${puckstackApiKey}`
			},
			body: JSON.stringify({
				workspaceSlug: 'ecohubs',
				email: session.user.email
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
			// Persist the Puckstack User ID so onboarding can auto-complete
			// the previously-manual "copy your User ID" step.
			const puckstackUserId = data.user.id;
			try {
				await db
					.update(user)
					.set({ puckstackUserId, updatedAt: new Date() })
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
			return json({
				success: true,
				joinUrl: data.invitation.joinUrl,
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
