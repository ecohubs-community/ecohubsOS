import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyMessage } from 'ethers';
import { isSafeOwnerViaAPI } from '$lib/server/safe-auth';
import { createJWT } from '$lib/server/auth-helpers';

// Simple in-memory rate limiting (for production, use Redis or similar)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): boolean {
	const now = Date.now();
	const limit = rateLimitMap.get(identifier);

	if (!limit || now > limit.resetTime) {
		rateLimitMap.set(identifier, {
			count: 1,
			resetTime: now + 60000 // 1 minute window
		});
		return true;
	}

	if (limit.count >= 5) {
		return false;
	}

	limit.count++;
	return true;
}

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
	try {
		const clientIp = getClientAddress();

		// Rate limiting
		if (!checkRateLimit(clientIp)) {
			return json(
				{ success: false, message: 'Too many requests. Please try again later.' },
				{ status: 429 }
			);
		}

		const { address, signature, message } = await request.json();

		// Validate input
		if (!address || !signature || !message) {
			error(400, 'Missing required fields: address, signature, message');
		}

		// Step 1: Verify the signature
		let recoveredAddress: string;
		try {
			recoveredAddress = verifyMessage(message, signature);
		} catch (err: unknown) {
			if (err instanceof Error) {
				console.error('Signature verification error:', err.message);
			} else {
				console.error('Signature verification error:', err);
			}
			error(401, 'Invalid signature format');
		}

		if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
			error(401, 'Invalid signature');
		}

		// Step 2: Check if address is a Safe owner
		const isOwner = await isSafeOwnerViaAPI(address);

		if (!isOwner) {
			error(403, 'Not a Safe owner');
		}

		// Step 3: Create session
		const jwt = await createJWT({ address, isOwner: true });

		// Set secure cookie
		cookies.set('auth_token', jwt, {
			path: '/',
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'strict',
			maxAge: 60 * 60 * 24 * 7 // 7 days
		});

		return json({ success: true, address });
	} catch (err) {
		console.error('Auth error:', err);
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		error(500, 'Authentication failed');
	}
};
