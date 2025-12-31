import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

/**
 * Discord OAuth2 Authorization Endpoint
 * Redirects user to Discord to authorize the app and grant permissions.
 * This is an onboarding step, not a login mechanism.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	// Verify user is authenticated to ecohubsOS
	if (!locals.user) {
		redirect(302, '/login');
	}

	const clientId = env.DISCORD_CLIENT_ID;
	if (!clientId) {
		console.error('DISCORD_CLIENT_ID not configured');
		error(500, 'Discord integration not configured');
	}

	const redirectUri = `${url.origin}/api/discord/callback`;

	// State parameter to prevent CSRF - include user wallet for verification
	const state = Buffer.from(
		JSON.stringify({
			wallet: locals.user.address,
			timestamp: Date.now()
		})
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
