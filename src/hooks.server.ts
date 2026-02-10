import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { dev } from '$app/environment';

// Security headers middleware
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Only add security headers in production
	if (!dev) {
		// Prevent clickjacking
		response.headers.set('X-Frame-Options', 'DENY');

		// Prevent MIME type sniffing
		response.headers.set('X-Content-Type-Options', 'nosniff');

		// Enable HSTS (1 year, include subdomains)
		response.headers.set(
			'Strict-Transport-Security',
			'max-age=31536000; includeSubDomains; preload'
		);

		// Control referrer information
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

		// Permissions policy (disable unnecessary features)
		response.headers.set(
			'Permissions-Policy',
			'camera=(), microphone=(), geolocation=(), payment=()'
		);

		// Content Security Policy
		// Note: Adjust these directives based on your actual external resources
		response.headers.set(
			'Content-Security-Policy',
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://snapshot.org",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data: https: blob:",
				"font-src 'self' data:",
				"connect-src 'self' https://snapshot.org https://seq.snapshot.org https://hub.snapshot.org https://safe-transaction-mainnet.safe.global https://discussions.ecohubs.community https://blueprint.ecohubs.community https://newsletter.ecohubs.community https://api.iconify.design",
				"frame-ancestors 'none'",
				"form-action 'self'",
				"base-uri 'self'"
			].join('; ')
		);
	}

	return response;
};

// Authentication middleware
const authHandler: Handle = async ({ event, resolve }) => {
	// Get session from BetterAuth
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		// Fetch full user data from database (includes custom fields)
		const dbUser = await db.query.user.findFirst({
			where: eq(userTable.id, session.user.id)
		});

		if (dbUser) {
			event.locals.user = {
				id: dbUser.id,
				name: dbUser.name,
				email: dbUser.email,
				emailVerified: dbUser.emailVerified ?? false,
				image: dbUser.image,
				createdAt: dbUser.createdAt,
				updatedAt: dbUser.updatedAt,
				authentikId: dbUser.authentikId,
				groups: dbUser.groups,
				roles: dbUser.roles,
				walletAddress: dbUser.walletAddress,
				walletConnectedAt: dbUser.walletConnectedAt,
				safeProposalTxHash: dbUser.safeProposalTxHash,
				safeOwnerStatus: dbUser.safeOwnerStatus as 'pending' | 'confirmed' | 'executed' | null,
				puckstackUserId: dbUser.puckstackUserId ?? null,
				onboardingProgress: dbUser.onboardingProgress ?? null
			};
			event.locals.session = {
				id: session.session.id,
				userId: session.session.userId,
				token: session.session.token,
				expiresAt: session.session.expiresAt,
				createdAt: session.session.createdAt,
				updatedAt: session.session.updatedAt,
				ipAddress: session.session.ipAddress ?? null,
				userAgent: session.session.userAgent ?? null
			};
		} else {
			event.locals.user = null;
			event.locals.session = null;
		}
	} else {
		event.locals.user = null;
		event.locals.session = null;
	}

	// Protect main desktop route - require authentication
	if (event.url.pathname === '/' || event.url.pathname.startsWith('/app')) {
		if (!event.locals.user) {
			redirect(303, '/login');
		}
	}

	// Redirect authenticated users away from login page
	if (event.url.pathname === '/login' && event.locals.user) {
		redirect(303, '/');
	}

	return resolve(event);
};

// Combine handlers: security headers first, then auth
export const handle = sequence(securityHeaders, authHandler);
