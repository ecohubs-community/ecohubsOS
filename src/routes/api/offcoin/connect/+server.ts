import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Connect a wallet address to an Offcoin member via Puckstack User ID
 *
 * Flow:
 * 1. Look up Offcoin member by puckstack:<userId> alias
 * 2. If found, add wallet:<walletAddress> alias to the member
 * 3. Return member data
 *
 * TODO: Replace mock implementation with actual Offcoin API calls
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Verify user is authenticated
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { puckstackUserId, walletAddress } = await request.json();

	if (!puckstackUserId || typeof puckstackUserId !== 'string') {
		error(400, 'Puckstack User ID is required');
	}

	if (!walletAddress || typeof walletAddress !== 'string') {
		error(400, 'Wallet address is required');
	}

	// Verify the wallet address matches the authenticated user
	if (walletAddress.toLowerCase() !== locals.user.address.toLowerCase()) {
		error(403, 'Wallet address does not match authenticated user');
	}

	try {
		// TODO: Replace with actual Offcoin API call
		// const member = await offcoinApi.findMemberByAlias(`puckstack:${puckstackUserId}`);
		// if (!member) { error(404, 'No Offcoin member found with this Puckstack ID'); }
		// await offcoinApi.addAlias(member.id, `wallet:${walletAddress}`);

		// MOCK IMPLEMENTATION - simulates successful connection
		// In production, this would call the Offcoin API
		const mockMember = {
			id: `mock-${puckstackUserId}`,
			name: 'EcoBuilder',
			xp: 2450,
			level: 5,
			eco: 125,
			role: 'Gardener',
			aliases: [`puckstack:${puckstackUserId}`, `wallet:${walletAddress.toLowerCase()}`]
		};

		return json({
			success: true,
			member: mockMember
		});
	} catch (err) {
		console.error('Offcoin connection error:', err);
		error(500, 'Failed to connect to Offcoin');
	}
};
