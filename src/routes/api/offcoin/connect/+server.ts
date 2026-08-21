import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOffcoinClient, withMemberAlias } from '$lib/server/offcoin';
import { saveOffcoinSnapshot } from '$lib/server/offcoin-snapshot';
import { NotFoundError } from '@offcoin/sdk';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { offcoinLogger } from '$lib/server/logger';
import { resolvePuckstackIdentity } from '$lib/server/puckstack-identity';
import { settleUnclaimedRewards } from '$lib/server/wayfinder-rewards';

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
 * Connect a wallet address to the caller's Offcoin member.
 *
 * Flow:
 * 1. Resolve the caller's Puckstack user id from their session email
 * 2. Look up the Offcoin member by the puckstack:<userId> alias
 * 3. If found, add wallet:<walletAddress> alias to the member
 * 4. Persist puckstackUserId to user DB record (for cross-device persistence)
 * 5. Return member data including XP, level, and token balance
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Verify user is authenticated
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { walletAddress } = await request.json();

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

	// The Puckstack id is resolved here, never accepted from the caller.
	//
	// It used to arrive in the request body, and nothing proved it belonged to
	// whoever sent it — the id is visible in the workspace, so any member could
	// name another's and, while it was still unlinked, attach their own wallet to
	// that person's Offcoin member. The link decides where a grant lands, whose
	// member an exit deletes and which level the gates read, so that was not a
	// display problem, it was someone else's economy.
	//
	// A stored id came from this same resolution (or the Puckstack signup step,
	// which uses it too), so it is already Puckstack's answer rather than a
	// claim, and needs no second round trip.
	let puckstackUserId = locals.user.puckstackUserId;
	if (!puckstackUserId) {
		const identity = await resolvePuckstackIdentity(
			locals.user.email,
			locals.user.puckstackInviteToken ?? undefined
		);

		if (identity.kind === 'invitation') {
			// Puckstack has never seen this address. `resolvePuckstackIdentity` has
			// just minted the join link they need, so this is a next step rather
			// than a dead end.
			error(409, 'Join the EcoHubs Puckstack workspace first, then connect.');
		}
		if (identity.kind === 'error') {
			error(identity.status, `Could not confirm your Puckstack account: ${identity.message}`);
		}

		puckstackUserId = identity.userId;
	}

	// Defence in depth. Resolution is by email and emails are unique per account,
	// so two accounts should never reach the same id — but the database enforces
	// this and a caller deserves an explanation rather than a constraint
	// violation.
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

		const { member, xpData, balanceData } = await withMemberAlias(
			puckstackUserId,
			async (alias) => {
				// Get member by Puckstack alias
				const member = await offcoin.members.get(alias);

				// Add wallet alias if not already present. Safe inside the retry:
				// this only runs once `members.get` has confirmed the alias, so a
				// fallback never leaves a wallet attached to a member we then
				// abandoned.
				const walletAlias = `wallet:${walletAddress.toLowerCase()}`;
				if (!member.aliases?.includes(walletAlias)) {
					await offcoin.members.addAlias(alias, walletAlias);
				}

				// Get XP/level and token balance in parallel
				const [xpData, balanceData] = await Promise.all([
					offcoin.members.getXp(alias),
					offcoin.members.getBalance(alias)
				]);
				return { member, xpData, balanceData };
			}
		);

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

		// Videos they finished before there was an account to pay into. The
		// welcome video auto-opens on a member's first load, so this is the
		// common case, not an edge one — without this sweep those rewards would
		// sit unclaimed forever. Never fatal: a payout problem must not read as a
		// failure to link.
		let wayfinderRewards = { eco: 0, xp: 0 };
		try {
			wayfinderRewards = await settleUnclaimedRewards(locals.user.id);
		} catch (rewardErr) {
			offcoinLogger.error(
				{ err: rewardErr, userId: locals.user.id },
				'Failed to settle Wayfinder rewards on connect'
			);
		}

		return json({
			success: true,
			// The client no longer supplies this, so it has to be told what the
			// server resolved — it keys the member refresh on it.
			puckstackUserId,
			// Non-zero only when linking just paid out a backlog, so the client can
			// tell them what they earned rather than letting it land silently.
			wayfinderRewards,
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
