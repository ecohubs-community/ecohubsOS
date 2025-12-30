import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '$env/dynamic/private';

export interface AuthPayload {
	address: string;
	isOwner: boolean;
	exp?: number;
}

function getSecret(): Uint8Array {
	const secretString = env.AUTH_SECRET || 'fallback-secret-change-in-production-min-32-chars';
	if (secretString.length < 32) {
		console.warn('AUTH_SECRET should be at least 32 characters long for security');
	}
	return new TextEncoder().encode(secretString);
}

/**
 * Create a JWT token for authenticated session
 */
export async function createJWT(payload: Omit<AuthPayload, 'exp'>): Promise<string> {
	const secret = getSecret();
	const jwt = await new SignJWT({
		address: payload.address,
		isOwner: payload.isOwner
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('7d')
		.sign(secret);

	return jwt;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyJWT(token: string): Promise<AuthPayload> {
	const secret = getSecret();
	try {
		const { payload } = await jwtVerify(token, secret);
		const jwtPayload = payload as JWTPayload & { address?: string; isOwner?: boolean };
		if (!jwtPayload.address || typeof jwtPayload.isOwner !== 'boolean') {
			throw new Error('Invalid token payload');
		}
		return {
			address: jwtPayload.address,
			isOwner: jwtPayload.isOwner,
			exp: jwtPayload.exp
		};
	} catch {
		throw new Error('Invalid or expired token');
	}
}
