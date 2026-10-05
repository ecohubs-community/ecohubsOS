import { env } from '$env/dynamic/private';
import { discordLogger } from '$lib/server/logger';

const DISCORD_API = 'https://discord.com/api/v10';

interface SendMessageOptions {
	channelId?: string;
	content: string;
}

export async function sendDiscordMessage(options: SendMessageOptions): Promise<boolean> {
	try {
		const channelId = options.channelId ?? env.DISCORD_NEWS_CHANNEL_ID;
		const botToken = env.DISCORD_BOT_TOKEN;

		if (!channelId) {
			discordLogger.warn('No Discord channel ID configured — skipping notification');
			return false;
		}

		if (!botToken) {
			discordLogger.warn('No DISCORD_BOT_TOKEN configured — skipping notification');
			return false;
		}

		const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
			method: 'POST',
			headers: {
				Authorization: `Bot ${botToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ content: options.content })
		});

		if (!response.ok) {
			const text = await response.text();
			discordLogger.error(
				{ status: response.status, body: text, channelId },
				'Failed to send Discord message'
			);
			return false;
		}

		discordLogger.info({ channelId }, 'Discord notification sent');
		return true;
	} catch (err) {
		discordLogger.error({ err }, 'Error sending Discord message');
		return false;
	}
}

/**
 * Put a Discord user in the guild with the Member role.
 *
 * Returns whether the role is actually held afterwards. The callback used to
 * log a failure here and carry on as though it had worked, so members finished
 * onboarding without the role and nobody found out until they asked.
 *
 * Common reasons for `false`: the bot's role sits below Member in the guild's
 * role list, the bot lacks Manage Roles / Create Invite, or the user is banned.
 */
export async function grantDiscordMemberRole(
	discordUserId: string,
	accessToken: string
): Promise<boolean> {
	const guildId = env.DISCORD_GUILD_ID;
	const roleId = env.DISCORD_MEMBER_ROLE_ID;
	const botToken = env.DISCORD_BOT_TOKEN;

	if (!guildId || !roleId || !botToken) {
		discordLogger.error('Discord guild/role/bot not configured — cannot grant Member role');
		return false;
	}

	try {
		// Adds them to the guild with the role in one call (needs guilds.join).
		const addMember = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
			method: 'PUT',
			headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ access_token: accessToken, roles: [roleId] })
		});

		if (addMember.status === 201) {
			discordLogger.info({ discordUserId }, 'Added Discord user to guild with Member role');
			return true;
		}

		if (addMember.status !== 204) {
			discordLogger.error(
				{ discordUserId, status: addMember.status, body: await addMember.text() },
				'Failed to add Discord user to guild'
			);
			return false;
		}

		// 204: already in the guild, and Discord ignores `roles` for existing
		// members — so the role has to be added separately.
		const addRole = await fetch(
			`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
			{ method: 'PUT', headers: { Authorization: `Bot ${botToken}` } }
		);
		if (addRole.ok) {
			discordLogger.info({ discordUserId }, 'Assigned Member role to existing Discord user');
			return true;
		}

		discordLogger.error(
			{ discordUserId, status: addRole.status, body: await addRole.text() },
			'Failed to assign Discord Member role'
		);
		return false;
	} catch (err) {
		discordLogger.error({ err, discordUserId }, 'Discord role assignment request failed');
		return false;
	}
}

/**
 * Remove the Member role from a Discord user.
 *
 * The inverse of the role assignment in the Discord OAuth callback. Removes the
 * role rather than kicking them from the server: leaving is their choice, and a
 * kick would be a harsher act than the membership decision warrants.
 *
 * Returns true when the role is gone — including when the user was not in the
 * guild or did not have it, since that is the desired end state.
 */
export async function removeDiscordMemberRole(discordUserId: string): Promise<boolean> {
	const guildId = env.DISCORD_GUILD_ID;
	const roleId = env.DISCORD_MEMBER_ROLE_ID;
	const botToken = env.DISCORD_BOT_TOKEN;

	if (!guildId || !roleId || !botToken) {
		discordLogger.warn('Discord guild/role/bot not configured — skipping role removal');
		return false;
	}

	try {
		const response = await fetch(
			`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
			{ method: 'DELETE', headers: { Authorization: `Bot ${botToken}` } }
		);

		// 404 = not in the guild, or role already absent. Either way, done.
		if (response.ok || response.status === 404) {
			discordLogger.info({ discordUserId }, 'Removed Discord Member role');
			return true;
		}

		discordLogger.error(
			{ status: response.status, body: await response.text() },
			'Failed to remove Discord Member role'
		);
		return false;
	} catch (err) {
		discordLogger.error({ err, discordUserId }, 'Discord role removal request failed');
		return false;
	}
}
