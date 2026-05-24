import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { dev } from '$app/environment';
import { hasPendingRetroactiveSteps } from '$lib/server/onboarding';

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
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data: https: blob:",
				"font-src 'self' data:",
				"connect-src 'self' https://safe-transaction-mainnet.safe.global https://discussions.ecohubs.community https://blueprint.ecohubs.community https://newsletter.ecohubs.community https://api.iconify.design",
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
				safeOwnerStatus: dbUser.safeOwnerStatus as
					| 'pending'
					| 'confirmed'
					| 'executed'
					| 'delegate_added'
					| null,
				safeRole: (dbUser.safeRole as 'owner' | 'proposer' | null) ?? null,
				safeRoleStatus: dbUser.safeRoleStatus ?? null,
				puckstackUserId: dbUser.puckstackUserId ?? null,
				puckstackInviteToken: dbUser.puckstackInviteToken ?? null,
				displayName: dbUser.displayName ?? null,
				avatar: dbUser.avatar ?? null,
				bio: dbUser.bio ?? null,
				languages: dbUser.languages ?? null,
				location: dbUser.location ?? null,
				contribution: dbUser.contribution ?? null,
				showOnWebsite: dbUser.showOnWebsite ?? true,
				onboardingProgress: dbUser.onboardingProgress ?? null,
				contributionProgress: dbUser.contributionProgress ?? null,
				onboardingStartedAt: dbUser.onboardingStartedAt ?? null,
				onboardingCompletedAt: dbUser.onboardingCompletedAt ?? null
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

	// Redirect authenticated users away from login page
	if (event.url.pathname === '/login' && event.locals.user) {
		redirect(303, '/');
	}

	// Protect main desktop route - require authentication
	if (event.url.pathname === '/' || event.url.pathname.startsWith('/app')) {
		if (!event.locals.user) {
			redirect(303, '/login');
		}
		// Gate: redirect to onboarding if not completed
		if (!event.locals.user.onboardingCompletedAt) {
			redirect(303, '/onboarding');
		}
		// Gate: existing users who finished onboarding before a new
		// retroactive substep was introduced (e.g. the manifesto) get
		// sent back to the wizard until they complete it.
		if (
			hasPendingRetroactiveSteps(
				event.locals.user.onboardingCompletedAt,
				event.locals.user.onboardingProgress
			)
		) {
			redirect(303, '/onboarding');
		}
	}

	// Protect onboarding route
	if (event.url.pathname === '/onboarding') {
		if (!event.locals.user) {
			redirect(303, '/login');
		}
		// Already completed onboarding — only redirect away if no
		// retroactive substeps are still pending.
		if (
			event.locals.user.onboardingCompletedAt &&
			!hasPendingRetroactiveSteps(
				event.locals.user.onboardingCompletedAt,
				event.locals.user.onboardingProgress
			)
		) {
			redirect(303, '/');
		}
	}

	return resolve(event);
};

// Combine handlers: security headers first, then auth
export const handle = sequence(securityHeaders, authHandler);
