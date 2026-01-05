import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { checkProposalStatus, isSafeOwner } from '$lib/server/safe-proposal';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const walletAddress = locals.user.walletAddress;

	if (!walletAddress) {
		return json({
			status: 'no_wallet',
			message: 'No wallet connected'
		});
	}

	// Check if already a Safe owner
	const alreadyOwner = await isSafeOwner(walletAddress);
	if (alreadyOwner) {
		// Update user status if not already set
		if (locals.user.safeOwnerStatus !== 'executed') {
			await db
				.update(user)
				.set({
					safeOwnerStatus: 'executed',
					updatedAt: new Date()
				})
				.where(eq(user.id, locals.user.id));
		}

		return json({
			status: 'executed',
			message: 'You are a Safe owner'
		});
	}

	// Check if there's a pending proposal
	const safeTxHash = locals.user.safeProposalTxHash;
	if (!safeTxHash) {
		return json({
			status: 'not_proposed',
			message: 'No proposal submitted yet'
		});
	}

	// Check the proposal status
	const result = await checkProposalStatus(safeTxHash);

	// Update user status if changed
	if (result.status !== locals.user.safeOwnerStatus) {
		await db
			.update(user)
			.set({
				safeOwnerStatus: result.status,
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));
	}

	return json({
		status: result.status,
		safeTxHash: result.safeTxHash,
		confirmations: result.confirmations,
		threshold: result.threshold,
		safeUrl: `https://app.safe.global/transactions/queue?safe=eth:${env.SAFE_ADDRESS}`,
		message:
			result.status === 'pending'
				? `Waiting for ${result.threshold! - result.confirmations!} more confirmation(s)`
				: result.status === 'confirmed'
					? 'Proposal confirmed, ready for execution'
					: result.status === 'executed'
						? 'You are now a Safe owner!'
						: 'Unknown status'
	});
};
