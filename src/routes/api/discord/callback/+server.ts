import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getOffcoinClient } from '$lib/server/offcoin';
import type { RequestHandler } from './$types';
import { discordLogger } from '$lib/server/logger';

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Discord OAuth2 Callback Endpoint
 * Handles the OAuth2 callback from Discord:
 * 1. Exchange code for access token
 * 2. Get Discord user ID
 * 3. Add discord:<userId> alias to Offcoin member
 * 4. Assign "Member" role via Bot API
 * 5. Redirect back to main page
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');

	// Handle user denying authorization
	if (errorParam) {
		discordLogger.info({ error: errorParam }, 'User denied Discord authorization');
		redirect(302, '/?discord=denied');
	}

	if (!code) {
		error(400, 'Missing authorization code');
	}

	// Verify state parameter to prevent CSRF
	if (!state) {
		error(400, 'Missing state parameter');
	}

	// Parse state to get user info (state contains the user ID even if session expired)
	let walletAddress: string | null;
	try {
		const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
		walletAddress = stateData.wallet ?? null;

		// Check timestamp (15 min expiry)
		if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
			error(400, 'Authorization expired - please try again');
		}
	} catch (err) {
		discordLogger.error({ err }, 'State verification failed');
		error(400, 'Invalid state parameter');
	}

	// Exchange code for access token
	const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.DISCORD_CLIENT_ID!,
			client_secret: env.DISCORD_CLIENT_SECRET!,
			grant_type: 'authorization_code',
			code,
			redirect_uri: `${url.origin}/api/discord/callback`
		})
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text();
		discordLogger.error({ errorText }, 'Discord token exchange failed');
		error(500, 'Failed to authenticate with Discord');
	}

	const tokens = await tokenResponse.json();

	// Get Discord user info
	const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${tokens.access_token}` }
	});

	if (!userResponse.ok) {
		discordLogger.error({ response: await userResponse.text() }, 'Failed to get Discord user info');
		error(500, 'Failed to get Discord user info');
	}

	const discordUser = await userResponse.json();
	const discordUserId = discordUser.id;
	const discordUsername = discordUser.username;

	// Add Discord alias to Offcoin member (if wallet is connected)
	if (walletAddress !== null) {
		try {
			const offcoin = getOffcoinClient();
			const walletAlias = `wallet:${walletAddress.toLowerCase()}`;
			const discordAlias = `discord:${discordUserId}`;

			// Get member by wallet alias and add Discord alias
			const member = await offcoin.members.get(walletAlias);
			if (!member.aliases?.includes(discordAlias)) {
				await offcoin.members.addAlias(walletAlias, discordAlias);
				discordLogger.info({ discordAlias, memberName: member.name }, 'Added Discord alias to member');
			}
		} catch (err) {
			discordLogger.error({ err }, 'Failed to add Discord alias to Offcoin');
			// Continue anyway - role assignment is more important for user experience
		}
	}

	// Assign "Member" role via Bot API
	const guildId = env.DISCORD_GUILD_ID;
	const roleId = env.DISCORD_MEMBER_ROLE_ID;
	const botToken = env.DISCORD_BOT_TOKEN;

	if (guildId && roleId && botToken) {
		try {
			// First, try to add user to guild (in case they're not a member yet)
			// This requires the guilds.join scope
			const addMemberResponse = await fetch(
				`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`,
				{
					method: 'PUT',
					headers: {
						Authorization: `Bot ${botToken}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						access_token: tokens.access_token,
						roles: [roleId] // Assign role immediately when adding
					})
				}
			);

			if (addMemberResponse.status === 201) {
				// User was added to guild with role
				discordLogger.info({ discordUsername }, 'Added Discord user to guild with Member role');
			} else if (addMemberResponse.status === 204) {
				// User was already in guild, need to add role separately
				const addRoleResponse = await fetch(
					`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
					{
						method: 'PUT',
						headers: { Authorization: `Bot ${botToken}` }
					}
				);

				if (addRoleResponse.ok) {
					discordLogger.info({ discordUsername }, 'Assigned Member role to existing Discord user');
				} else {
					discordLogger.error({ response: await addRoleResponse.text() }, 'Failed to assign role');
				}
			} else {
				discordLogger.error({ response: await addMemberResponse.text() }, 'Failed to add member to guild');
			}
		} catch (err) {
			discordLogger.error({ err }, 'Discord role assignment error');
			// Continue anyway - user can still see that Discord was connected
		}
	} else {
		discordLogger.warn('Discord guild/role not configured - skipping role assignment');
	}

	// Store Discord connection info in a cookie for the client to read
	cookies.set(
		'discord_connected',
		JSON.stringify({
			userId: discordUserId,
			username: discordUsername
		}),
		{
			path: '/',
			httpOnly: false, // Allow client-side read
			maxAge: 60 // Short-lived - just for the redirect
		}
	);

	// Redirect back to main page - client will handle step completion
	redirect(302, '/?discord=connected');
};
