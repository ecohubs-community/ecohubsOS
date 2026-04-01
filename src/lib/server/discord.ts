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
