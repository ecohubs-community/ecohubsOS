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
