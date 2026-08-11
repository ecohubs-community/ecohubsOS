import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOffcoinClient, memberAlias } from '$lib/server/offcoin';
import { saveOffcoinSnapshot } from '$lib/server/offcoin-snapshot';
import { NotFoundError } from '@offcoin/sdk';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { offcoinLogger } from '$lib/server/logger';

/**
 * Whether a driver error is the unique index on `puckstack_user_id` refusing a
 * second claim. better-sqlite3 reports these on `code`; the message is not
 * stable enough to match on.
 */
function isUniqueViolation(err: unknown): boolean {
	const code = (err as { code?: unknown })?.code;
	return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT_UNIQUE');
}

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

	// The Puckstack id comes from the request body and nothing above proves it
	// belongs to the caller. Without this check three accounts ended up sharing
	// one link, and the link decides where a grant lands, whose member an exit
	// deletes, and which level the gates read — so a wrong one is not a display
	// problem, it is someone else's economy.
	//
	// The database now enforces this too; the check exists so the caller gets an
	// explanation rather than a constraint violation.
	const alreadyLinked = await db.query.user.findFirst({
		where: eq(user.puckstackUserId, puckstackUserId)
	});
	if (alreadyLinked && alreadyLinked.id !== locals.user.id) {
		offcoinLogger.warn(
			{ userId: locals.user.id, puckstackUserId, heldBy: alreadyLinked.id },
			'Refused a Puckstack link already held by another account'
		);
		error(409, 'That Puckstack account is already linked to another member');
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
		} catch (dbErr) {
			// The 409 above is a check-then-act: two requests can both pass it and
			// only one can win the unique index. Losing that race means the link is
			// held by someone else, so this is the same refusal — reported as one.
			// Swallowing it and returning success told the loser their link had
			// landed when the row still points at another account.
			if (isUniqueViolation(dbErr)) {
				offcoinLogger.warn(
					{ err: dbErr, userId: locals.user.id, puckstackUserId },
					'Lost the race for a Puckstack link'
				);
				error(409, 'That Puckstack account is already linked to another member');
			}

			offcoinLogger.error(
				{ err: dbErr, userId: locals.user.id, puckstackUserId },
				'Failed to persist puckstackUserId to DB (non-fatal)'
			);
			// Non-fatal: connection still works via localStorage, will retry next connect
		}

		// Linking is the first moment their level is knowable, and the figures were
		// just fetched above — so seed the snapshot rather than waiting for a
		// webhook that may not fire for months. `saveOffcoinSnapshot` never throws
		// and reports its own failures, so it sits outside the catch above.
		await saveOffcoinSnapshot(locals.user.id, {
			memberId: member.id,
			xp: xpData.xp,
			level: xpData.level,
			// Already fetched for the response below; persisting it costs nothing
			// and spares a newly linked member a null balance until the next sync.
			eco: balanceData.balance
		});
		offcoinLogger.info(
			{ userId: locals.user.id, puckstackUserId },
			'Persisted puckstackUserId to user record'
		);

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
		// A refusal we already decided on — the 409 for a link held by someone
		// else. Without this it would be relabelled as a 500 and the caller would
		// be told the integration is broken rather than what actually happened.
		if (isHttpError(err)) throw err;

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
