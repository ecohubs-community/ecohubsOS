import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOffcoinClient, memberAlias } from '$lib/server/offcoin';
import { saveOffcoinSnapshot } from '$lib/server/offcoin-snapshot';
import { NotFoundError } from '@offcoin/sdk';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { offcoinLogger } from '$lib/server/logger';

/**
 * Connect a wallet address to an Offcoin member via Puckstack User ID
 *
 * Flow:
 * 1. Look up Offcoin member by puckstack:<userId> alias
 * 2. If found, add wallet:<walletAddress> alias to the member
 * 3. Persist puckstackUserId to user DB record (for cross-device persistence)
 * 4. Return member data including XP, level, and token balance
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
	if (
		!locals.user.walletAddress ||
		walletAddress.toLowerCase() !== locals.user.walletAddress.toLowerCase()
	) {
		error(403, 'Wallet address does not match authenticated user');
	}

	try {
		const offcoin = getOffcoinClient();
		const alias = memberAlias(puckstackUserId);

		// Get member by Puckstack alias
		const member = await offcoin.members.get(alias);

		// Add wallet alias if not already present
		const walletAlias = `wallet:${walletAddress.toLowerCase()}`;
		if (!member.aliases?.includes(walletAlias)) {
			await offcoin.members.addAlias(alias, walletAlias);
		}

		// Get XP/level and token balance in parallel
		const [xpData, balanceData] = await Promise.all([
			offcoin.members.getXp(alias),
			offcoin.members.getBalance(alias)
		]);

		// Persist puckstackUserId to user DB record for cross-device persistence
		try {
			await db
				.update(user)
				.set({
					puckstackUserId,
					updatedAt: new Date()
				})
				.where(eq(user.id, locals.user.id));

			// Linking is the first moment their level is knowable, and the figures
			// were just fetched above — so seed the snapshot rather than waiting for
			// a webhook that may not fire for months.
			await saveOffcoinSnapshot(locals.user.id, {
				memberId: member.id,
				xp: xpData.xp,
				level: xpData.level
			});
			offcoinLogger.info(
				{ userId: locals.user.id, puckstackUserId },
				'Persisted puckstackUserId to user record'
			);
		} catch (dbErr) {
			offcoinLogger.error(
				{ err: dbErr, userId: locals.user.id, puckstackUserId },
				'Failed to persist puckstackUserId to DB (non-fatal)'
			);
			// Non-fatal: connection still works via localStorage, will retry next connect
		}

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
			error(
				404,
				'No Offcoin member found with this Puckstack ID. Please ensure you have created a Puckstack account first.'
			);
		}
		offcoinLogger.error({ err }, 'Offcoin connection error');
		error(500, 'Failed to connect to Offcoin');
	}
};
