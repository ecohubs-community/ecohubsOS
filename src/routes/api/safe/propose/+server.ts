import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { proposeAddOwner, isSafeOwner } from '$lib/server/safe-proposal';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const walletAddress = locals.user.walletAddress;

	if (!walletAddress) {
		error(400, 'No wallet connected. Please connect your wallet first.');
	}

	// Check if already an owner
	const alreadyOwner = await isSafeOwner(walletAddress);
	if (alreadyOwner) {
		// Update user status
		await db
			.update(user)
			.set({
				safeOwnerStatus: 'executed',
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));

		return json({
			success: true,
			status: 'already_owner',
			message: 'You are already a Safe owner'
		});
	}

	// Check if already has a pending proposal
	if (locals.user.safeProposalTxHash && locals.user.safeOwnerStatus === 'pending') {
		return json({
			success: false,
			status: 'pending',
			safeTxHash: locals.user.safeProposalTxHash,
			message: 'You already have a pending proposal'
		});
	}

	// Propose adding the user as a Safe owner
	const result = await proposeAddOwner(walletAddress);

	if (!result.success) {
		error(500, result.error || 'Failed to propose Safe owner addition');
	}

	// Update user with the proposal tx hash
	await db
		.update(user)
		.set({
			safeProposalTxHash: result.safeTxHash,
			safeOwnerStatus: 'pending',
			updatedAt: new Date()
		})
		.where(eq(user.id, locals.user.id));

	return json({
		success: true,
		status: 'pending',
		safeTxHash: result.safeTxHash,
		message: 'Proposal submitted. Waiting for Safe owners to approve.'
	});
};
