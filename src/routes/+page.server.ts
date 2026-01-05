import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Redirect to login if not authenticated
	if (!locals.user) {
		redirect(303, '/login');
	}

	// Parse JSON fields for client
	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			emailVerified: locals.user.emailVerified,
			image: locals.user.image,
			groups: JSON.parse(locals.user.groups || '[]'),
			roles: JSON.parse(locals.user.roles || '[]'),
			walletAddress: locals.user.walletAddress,
			safeOwnerStatus: locals.user.safeOwnerStatus
		}
	};
};
