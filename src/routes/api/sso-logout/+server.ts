import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { buildSsoLogoutUrl } from '$lib/server/authentik';

/**
 * Where to send the browser after the local sign-out, so the Authentik session
 * ends too.
 *
 * Deliberately *not* under `/api/auth`: a concrete route there silently shadows
 * the better-auth catch-all, so a future better-auth endpoint of the same name
 * would break invisibly.
 *
 * This has to be read *before* signing out — the id token is fetched by user
 * id, and after sign-out there is no user id to fetch it with. Hence a separate
 * call rather than folding it into the sign-out request.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const [linked] = await db
		.select({ idToken: account.idToken })
		.from(account)
		.where(and(eq(account.userId, locals.user.id), eq(account.providerId, 'authentik')));

	// The member lands back on /login, which redirects them onward if they still
	// have a session — they will not.
	const base = env.VITE_PUBLIC_APP_URL || url.origin;
	const postLogoutRedirectUri = new URL('/login', base).toString();

	// Null when discovery is unreachable. The client still signs out locally and
	// falls back to /login: a working local logout beats refusing to log out at
	// all because the identity provider could not be asked.
	const ssoLogoutUrl = await buildSsoLogoutUrl(linked?.idToken ?? null, postLogoutRedirectUri);

	return json({ url: ssoLogoutUrl });
};
