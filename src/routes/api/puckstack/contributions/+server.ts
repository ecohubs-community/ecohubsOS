import { json, type RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { env } from '$env/dynamic/private';
import { puckstackLogger } from '$lib/server/logger';

interface CountsResponse {
	success: boolean;
	isMember: boolean;
	counts: { unreadNotifications: number; tasksNeedingReview: number; openTasks: number };
}

const ZEROS: CountsResponse = {
	success: false,
	isMember: false,
	counts: { unreadNotifications: 0, tasksNeedingReview: 0, openTasks: 0 }
};

/**
 * GET /api/puckstack/contributions — proxy to Puckstack's contribution counts
 * for the logged-in user's ecohubs workspace. Used by the "Immediate
 * Contributions" desktop card.
 *
 * Degrades gracefully: any error (unconfigured, unreachable, non-OK) returns
 * 200 with zero counts + isMember:false so the card just hides the dynamic
 * items rather than showing an error.
 */
export const GET: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const puckstackApiUrl = env.PUCKSTACK_API_URL;
	const puckstackApiKey = env.PUCKSTACK_API_KEY;
	if (!puckstackApiUrl || !puckstackApiKey) {
		puckstackLogger.error('PUCKSTACK_API_URL or PUCKSTACK_API_KEY not configured');
		return json(ZEROS);
	}

	try {
		const response = await fetch(`${puckstackApiUrl}/contributions/counts`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${puckstackApiKey}`
			},
			body: JSON.stringify({ workspaceSlug: 'ecohubs', email: session.user.email })
		});

		if (!response.ok) {
			puckstackLogger.error(
				{ status: response.status },
				'Puckstack contributions/counts returned non-OK'
			);
			return json(ZEROS);
		}

		const data = (await response.json()) as CountsResponse;
		return json({
			success: true,
			isMember: !!data.isMember,
			counts: data.counts ?? ZEROS.counts
		});
	} catch (err) {
		puckstackLogger.error({ err }, 'Failed to fetch Puckstack contribution counts');
		return json(ZEROS);
	}
};
