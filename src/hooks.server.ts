import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { verifyJWT } from '$lib/server/auth-helpers';

export const handle: Handle = async ({ event, resolve }) => {
	// Get token from cookie
	const token = event.cookies.get('auth_token');

	// Verify token and add to locals
	if (token) {
		try {
			const payload = await verifyJWT(token);
			event.locals.user = payload;
		} catch {
			// Invalid token, clear cookie
			event.cookies.delete('auth_token', { path: '/' });
		}
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
