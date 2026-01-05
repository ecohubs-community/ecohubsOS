import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = await request.json();
	const { walletAddress } = body;

	if (!walletAddress || typeof walletAddress !== 'string') {
		error(400, 'Invalid wallet address');
	}

	// Validate Ethereum address format
	if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
		error(400, 'Invalid Ethereum address format');
	}

	const normalizedAddress = walletAddress.toLowerCase();

	try {
		// Check if wallet is already connected to another user
		const existingUser = await db.query.user.findFirst({
			where: eq(user.walletAddress, normalizedAddress)
		});

		if (existingUser && existingUser.id !== locals.user.id) {
			error(409, 'This wallet is already connected to another account');
		}

		// Update user's wallet address
		await db
			.update(user)
			.set({
				walletAddress: normalizedAddress,
				walletConnectedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(user.id, locals.user.id));

		return json({ success: true, walletAddress: normalizedAddress });
	} catch (err) {
		console.error('Error connecting wallet:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		error(500, 'Failed to connect wallet');
	}
};
