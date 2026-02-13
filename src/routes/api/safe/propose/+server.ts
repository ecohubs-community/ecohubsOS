import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addSafeDelegate, isSafeDelegate, isSafeOwner, proposeAddOwner } from '$lib/server/safe-proposal';
import { env } from '$env/dynamic/private';

function isHttpError(err: unknown): err is { status: number; body: unknown } {
	return (
		typeof err === 'object' &&
		err !== null &&
		'status' in err &&
		typeof (err as { status?: unknown }).status === 'number' &&
		'body' in err
	);
}

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const walletAddress = locals.user.walletAddress;
	const onboardingRole = (env.SAFE_ONBOARDING_ROLE || 'owner').toLowerCase();
	const shouldAddDelegate = onboardingRole === 'proposer' || onboardingRole === 'delegate';

	if (!walletAddress) {
		error(400, 'No wallet connected. Please connect your wallet first.');
	}

	try {
		const alreadyOwner = await isSafeOwner(walletAddress);
		if (alreadyOwner) {
			await db
				.update(user)
				.set({
					safeOwnerStatus: 'executed',
					safeRole: 'owner',
					safeRoleStatus: 'executed',
					updatedAt: new Date()
				})
				.where(eq(user.id, locals.user.id));

			return json({
				success: true,
				status: 'already_owner',
				message: 'You are already a Safe owner'
			});
		}

		if (shouldAddDelegate) {
			const alreadyDelegate = await isSafeDelegate(walletAddress);
			if (alreadyDelegate) {
				await db
					.update(user)
					.set({
						safeProposalTxHash: null,
						safeOwnerStatus: 'delegate_added',
						safeRole: 'proposer',
						safeRoleStatus: 'delegate_added',
						updatedAt: new Date()
					})
					.where(eq(user.id, locals.user.id));

				return json({
					success: true,
					status: 'delegate_added',
					message: 'You are already a Safe proposer'
				});
			}

			const result = await addSafeDelegate(walletAddress);
			if (!result.success) {
				error(500, result.error || 'Failed to register Safe proposer');
			}

			await db
				.update(user)
				.set({
					safeProposalTxHash: null,
					safeOwnerStatus: 'delegate_added',
					safeRole: 'proposer',
					safeRoleStatus: 'delegate_added',
					updatedAt: new Date()
				})
				.where(eq(user.id, locals.user.id));

			return json({
				success: true,
				status: 'delegate_added',
				message: 'Proposer access granted. You can now propose transactions.'
			});
		}

		if (locals.user.safeProposalTxHash && locals.user.safeOwnerStatus === 'pending') {
			return json({
				success: false,
				status: 'pending',
				safeTxHash: locals.user.safeProposalTxHash,
				message: 'You already have a pending proposal'
			});
		}

		const result = await proposeAddOwner(walletAddress);

		if (!result.success) {
			error(500, result.error || 'Failed to propose Safe owner addition');
		}

		await db
			.update(user)
			.set({
				safeProposalTxHash: result.safeTxHash,
				safeOwnerStatus: 'pending',
				safeRole: 'owner',
				safeRoleStatus: 'pending',
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));

		return json({
			success: true,
			status: 'pending',
			safeTxHash: result.safeTxHash,
			message: 'Proposal submitted. Waiting for Safe owners to approve.'
		});
	} catch (err) {
		if (isHttpError(err)) {
			throw err;
		}
		const message = err instanceof Error ? err.message : '';
		if (message) {
			error(500, message);
		}
		error(500, shouldAddDelegate ? 'Failed to register Safe proposer' : 'Failed to propose Safe owner addition');
	}
};
