import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Get Offcoin member data by Puckstack User ID
 *
 * TODO: Replace mock implementation with actual Offcoin API calls
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
		// TODO: Replace with actual Offcoin API call
		// const member = await offcoinApi.findMemberByAlias(`puckstack:${puckstackUserId}`);
		// if (!member) { error(404, 'Member not found'); }

		// MOCK IMPLEMENTATION
		const mockMember = {
			id: `mock-${puckstackUserId}`,
			name: 'EcoBuilder',
			xp: 2450,
			level: 5,
			eco: 125,
			role: 'Gardener',
			aliases: [`puckstack:${puckstackUserId}`, `wallet:${locals.user.address.toLowerCase()}`]
		};

		return json({
			success: true,
			member: mockMember
		});
	} catch (err) {
		console.error('Offcoin member lookup error:', err);
		error(500, 'Failed to fetch member data');
	}
};
