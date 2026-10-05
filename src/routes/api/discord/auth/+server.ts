import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { discordLogger } from '$lib/server/logger';
import { DISCORD_STATE_COOKIE, safeReturnTo } from '$lib/server/discord-oauth';

/**
 * Discord OAuth2 Authorization Endpoint
 * Redirects user to Discord to authorize the app and grant permissions.
 * This is an onboarding step, not a login mechanism.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	// Verify user is authenticated to ecohubsOS
	if (!locals.user) {
		redirect(302, '/login');
	}

	const clientId = env.DISCORD_CLIENT_ID;
	if (!clientId) {
		discordLogger.error('DISCORD_CLIENT_ID not configured');
		error(500, 'Discord integration not configured');
	}

	const redirectUri = `${url.origin}/api/discord/callback`;

	// CSRF: a random nonce in an httpOnly cookie, echoed through `state`. The
	// callback refuses a state that does not match. The state used to be plain
	// base64 JSON carrying a wallet address, so anyone could forge one and
	// attach their Discord account to someone else's Offcoin member.
	const nonce = crypto.randomUUID();
	cookies.set(DISCORD_STATE_COOKIE, nonce, {
		path: '/api/discord',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 15 * 60
	});

	const state = Buffer.from(
		JSON.stringify({ nonce, returnTo: safeReturnTo(url.searchParams.get('returnTo')) })
	).toString('base64url');

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'identify guilds.join', // identify = get user ID, guilds.join = add to server
		state
	});

	redirect(302, `https://discord.com/oauth2/authorize?${params}`);
};
