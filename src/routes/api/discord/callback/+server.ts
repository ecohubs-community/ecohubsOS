import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { getOffcoinClient, withMemberAlias } from '$lib/server/offcoin';
import { grantDiscordMemberRole } from '$lib/server/discord';
import {
	DISCORD_STATE_COOKIE,
	readDiscordState,
	withDiscordResult
} from '$lib/server/discord-oauth';
import { recordVerifiedSubstep } from '$lib/server/onboarding';
import { discordLogger } from '$lib/server/logger';

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Discord OAuth2 Callback Endpoint
 *
 * 1. Check `state` against the nonce cookie set by /api/discord/auth
 * 2. Exchange the code and read the Discord user id
 * 3. Grant the Member role (joining the guild if needed)
 * 4. Store the Discord id; only if the role landed, mark `discord-connect` done
 * 5. Redirect back with `?discord=connected`, `failed`, `denied` or `already_linked`
 *
 * The step used to be marked done by the browser on any return here, and role
 * failures were only logged — so a member could finish onboarding without the
 * role, and nobody knew.
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	// The session cookie is SameSite=Lax, so it survives the top-level redirect
	// back from Discord. Acting on the session rather than an id in `state`
	// means a forged state cannot point the result at someone else.
	if (!locals.user) {
		redirect(302, '/login');
	}

	const verified = readDiscordState(
		url.searchParams.get('state'),
		cookies.get(DISCORD_STATE_COOKIE)
	);
	cookies.delete(DISCORD_STATE_COOKIE, { path: '/api/discord' });

	if (!verified) {
		discordLogger.warn(
			{ userId: locals.user.id },
			'Discord callback with invalid or expired state'
		);
		error(400, 'Discord authorization expired or was not started here — please try again');
	}
	const { returnTo } = verified;

	if (url.searchParams.get('error')) {
		discordLogger.info(
			{ error: url.searchParams.get('error') },
			'User denied Discord authorization'
		);
		redirect(302, withDiscordResult(returnTo, 'denied'));
	}

	const code = url.searchParams.get('code');
	if (!code) {
		error(400, 'Missing authorization code');
	}

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
		discordLogger.error({ errorText: await tokenResponse.text() }, 'Discord token exchange failed');
		redirect(302, withDiscordResult(returnTo, 'failed'));
	}

	const tokens = await tokenResponse.json();

	const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${tokens.access_token}` }
	});

	if (!userResponse.ok) {
		discordLogger.error({ response: await userResponse.text() }, 'Failed to get Discord user info');
		redirect(302, withDiscordResult(returnTo, 'failed'));
	}

	const discordUser = await userResponse.json();
	const discordUserId: string = discordUser.id;

	// One Discord account per member once the role is granted. Switching would
	// hand the role to a second account while exit only knows one id, leaving
	// the other's role beyond cleanup — so refuse before granting anything. A
	// link whose role never landed has nothing to clean up and may be replaced.
	const existing = await db.query.user.findFirst({ where: eq(userTable.id, locals.user.id) });
	if (
		existing?.discordUserId &&
		existing.discordConnectedAt &&
		existing.discordUserId !== discordUserId
	) {
		discordLogger.warn(
			{ userId: locals.user.id, linked: existing.discordUserId, attempted: discordUserId },
			'Refused to link a second Discord account'
		);
		redirect(302, withDiscordResult(returnTo, 'already_linked'));
	}

	const granted = await grantDiscordMemberRole(discordUserId, tokens.access_token);

	// Store the id either way — it is what exit uses to strip the role, and what
	// a steward needs to look into a failed grant. Only a granted role sets
	// `discordConnectedAt`, which is what completes the onboarding step.
	await db
		.update(userTable)
		.set({
			discordUserId,
			...(granted ? { discordConnectedAt: new Date() } : {}),
			updatedAt: new Date()
		})
		.where(eq(userTable.id, locals.user.id));

	if (granted) {
		await recordVerifiedSubstep(locals.user.id, 'discord-connect');
	} else {
		discordLogger.error(
			{ userId: locals.user.id, discordUserId, discordUsername: discordUser.username },
			'Discord connected but Member role not granted — onboarding step left open'
		);
	}

	// Mirror the link on the Offcoin member, addressed by Puckstack id. It was
	// addressed by wallet, which onboarding no longer collects, so most members
	// never got it. Best-effort: the local column is the record that matters.
	if (locals.user.puckstackUserId) {
		try {
			const discordAlias = `discord:${discordUserId}`;
			await withMemberAlias(locals.user.puckstackUserId, async (alias) => {
				const offcoin = getOffcoinClient();
				const member = await offcoin.members.get(alias);
				if (!member.aliases?.includes(discordAlias)) {
					await offcoin.members.addAlias(alias, discordAlias);
				}
			});
		} catch (err) {
			discordLogger.error(
				{ err, userId: locals.user.id },
				'Failed to add Discord alias to Offcoin'
			);
		}
	}

	redirect(302, withDiscordResult(returnTo, granted ? 'connected' : 'failed'));
};
