import { auth } from '$lib/server/auth';
import { checkRateLimit, AUTH_RATE_LIMIT } from '$lib/server/rateLimit';
import { authLogger } from '$lib/server/logger';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	return auth.handler(request);
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Apply rate limiting to POST requests (login attempts, etc.)
	const clientIp = getClientAddress();
	if (!checkRateLimit(AUTH_RATE_LIMIT, clientIp)) {
		authLogger.warn({ clientIp }, 'Auth rate limit exceeded');
		return json(
			{ error: 'Too many authentication attempts. Please try again later.' },
			{ status: 429 }
		);
	}

	return auth.handler(request);
};

// Handle CORS preflight requests for OAuth flows
export const OPTIONS: RequestHandler = async ({ request }) => {
	return auth.handler(request);
};
