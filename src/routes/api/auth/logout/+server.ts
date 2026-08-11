import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request }) => {
	// Sign out using BetterAuth
	await auth.api.signOut({ headers: request.headers });
	return json({ success: true });
};
