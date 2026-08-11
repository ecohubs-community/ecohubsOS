import { auth } from '$lib/server/auth';
import { checkRateLimit, AUTH_RATE_LIMIT } from '$lib/server/rateLimit';
import { clientIp } from '$lib/server/client-ip';
import { authLogger } from '$lib/server/logger';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Paths under `/api/auth` that are exempt from `AUTH_RATE_LIMIT`.
 *
 * The limiter is there to slow down credential guessing. Signing out is not an
 * attempt at anything — an attacker gains nothing by ending a session, while a
 * false positive strands a member in a session they have asked to leave. Until
 * now sign-out drew from the same budget as sign-in, so ten auth requests in a
 * quarter of an hour disabled the logout button.
 */
const RATE_LIMIT_EXEMPT_PATHS = new Set(['/api/auth/sign-out']);

export const GET: RequestHandler = async ({ request }) => {
	return auth.handler(request);
};

export const POST: RequestHandler = async (event) => {
	const { request, url } = event;

	// Apply rate limiting to POST requests (login attempts, etc.)
	if (!RATE_LIMIT_EXEMPT_PATHS.has(url.pathname.replace(/\/+$/, ''))) {
		const ip = clientIp(event);
		if (!checkRateLimit(AUTH_RATE_LIMIT, ip)) {
			authLogger.warn({ clientIp: ip, path: url.pathname }, 'Auth rate limit exceeded');
			return json(
				{ error: 'Too many authentication attempts. Please try again later.' },
				{ status: 429 }
			);
		}
	}

	return auth.handler(request);
};

// Handle CORS preflight requests for OAuth flows
export const OPTIONS: RequestHandler = async ({ request }) => {
	return auth.handler(request);
};
