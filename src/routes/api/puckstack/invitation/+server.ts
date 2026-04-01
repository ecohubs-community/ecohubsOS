import { json, type RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { env } from '$env/dynamic/private';
import { puckstackLogger } from '$lib/server/logger';

/**
 * Proxy endpoint to generate Puckstack workspace invitation.
 * Requires authenticated ecohubsOS session.
 */
export const POST: RequestHandler = async ({ request }) => {
	// Verify authentication
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

		const data = await response.json();

		// If already a member, return workspace URL
		if (data.alreadyMember) {
			return json({
				success: true,
				alreadyMember: true,
				workspaceUrl: data.workspace?.url || 'https://puckstack.xyz/ecohubs/'
			});
		}

		// Return join URL
		return json({
			success: true,
			joinUrl: data.invitation?.joinUrl,
			expiresAt: data.invitation?.expiresAt
		});
	} catch (err) {
		puckstackLogger.error({ err }, 'Failed to connect to Puckstack');
		return json({ success: false, error: 'Failed to connect to Puckstack' }, { status: 500 });
	}
};
