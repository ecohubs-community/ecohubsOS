import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOffcoinClient } from '$lib/server/offcoin';
import { NotFoundError } from '@offcoin/sdk';

/**
 * Get Offcoin member data by Puckstack User ID
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	// Verify user is authenticated
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const puckstackUserId = url.searchParams.get('puckstackUserId');

	if (!puckstackUserId) {
		error(400, 'Puckstack User ID is required');
	}

	try {
		const offcoin = getOffcoinClient();
		const alias = `puckstack:${puckstackUserId}`;

		// Get member data
		const member = await offcoin.members.get(alias);

		// Get XP/level and token balance in parallel
		const [xpData, balanceData] = await Promise.all([
			offcoin.members.getXp(alias),
			offcoin.members.getBalance(alias)
		]);

		return json({
			success: true,
			member: {
				id: member.id,
				name: member.name,
				xp: xpData.xp,
				level: xpData.level,
				eco: balanceData.balance,
				role: (member.metadata as Record<string, string>)?.role ?? 'Member',
				aliases: member.aliases || []
			}
		});
	} catch (err) {
		if (err instanceof NotFoundError) {
			error(404, 'Member not found');
		}
		console.error('Offcoin member lookup error:', err);
		error(500, 'Failed to fetch member data');
	}
};
