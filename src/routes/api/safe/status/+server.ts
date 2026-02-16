import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { checkProposalStatus, getSafeAddress, isSafeDelegate, isSafeOwner } from '$lib/server/safe-proposal';
import { env } from '$env/dynamic/private';
import { safeLogger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const walletAddress = locals.user.walletAddress;
	const onboardingRole = (env.SAFE_ONBOARDING_ROLE || 'owner').toLowerCase();
	const shouldAddDelegate = onboardingRole === 'proposer' || onboardingRole === 'delegate';

	if (!walletAddress) {
		return json({
			status: 'no_wallet',
			message: 'No wallet connected'
		});
	}

	// Check if already a Safe owner
	let safeAddress: string | null = null;
	try {
		safeAddress = getSafeAddress();
	} catch (err) {
		safeLogger.error(
			{
				err,
				onboardingRole,
				chainId: env.SAFE_CHAIN_ID ?? null,
				safeAddress: env.SAFE_ADDRESS ?? null
			},
			'Safe configuration error'
		);
		return json(
			{
				status: 'error',
				message: err instanceof Error ? err.message : 'Safe configuration is invalid',
				details: {
					onboardingRole,
					chainId: env.SAFE_CHAIN_ID ?? null,
					safeAddress: env.SAFE_ADDRESS ?? null
				}
			},
			{ status: 500 }
		);
	}

	const alreadyOwner = await isSafeOwner(walletAddress);
	if (alreadyOwner) {
		// Update user status if not already set
		if (locals.user.safeOwnerStatus !== 'executed') {
			await db
				.update(user)
				.set({
					safeOwnerStatus: 'executed',
					safeRole: 'owner',
					safeRoleStatus: 'executed',
					updatedAt: new Date()
				})
				.where(eq(user.id, locals.user.id));
		}

		return json({
			status: 'executed',
			message: 'You are a Safe owner'
		});
	}

	if (shouldAddDelegate) {
		const alreadyDelegate = await isSafeDelegate(walletAddress);
		if (alreadyDelegate) {
			if (locals.user.safeOwnerStatus !== 'delegate_added') {
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
			}

			return json({
				status: 'delegate_added',
				safeUrl: `https://app.safe.global/transactions/queue?safe=eth:${safeAddress}`,
				message: 'You are a Safe proposer'
			});
		}

		return json({
			status: 'not_proposed',
			safeUrl: `https://app.safe.global/transactions/queue?safe=eth:${safeAddress}`,
			message: 'No proposer access granted yet'
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
				safeRole: 'owner',
				safeRoleStatus: result.status,
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));
	}

	return json({
		status: result.status,
		safeTxHash: result.safeTxHash,
		confirmations: result.confirmations,
		threshold: result.threshold,
		safeUrl: `https://app.safe.global/transactions/queue?safe=eth:${safeAddress}`,
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
