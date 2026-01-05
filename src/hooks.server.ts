import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const handle: Handle = async ({ event, resolve }) => {
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
				safeOwnerStatus: dbUser.safeOwnerStatus as 'pending' | 'confirmed' | 'executed' | null
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
