import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOffcoinClient, memberAlias } from '$lib/server/offcoin';
import { saveOffcoinSnapshot } from '$lib/server/offcoin-snapshot';
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
		const alias = memberAlias(puckstackUserId);

		// Get member data
		const member = await offcoin.members.get(alias);

		// Get XP/level and token balance in parallel
		const [xpData, balanceData] = await Promise.all([
			offcoin.members.getXp(alias),
			offcoin.members.getBalance(alias)
		]);

		// The figures are already in hand, so keep them. Without this the gates
		// read a null level for anyone who has never had a webhook or a grant.
		await saveOffcoinSnapshot(locals.user.id, {
			memberId: member.id,
			xp: xpData.xp,
			level: xpData.level
		});

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
