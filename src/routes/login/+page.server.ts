import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// If user is already authenticated, redirect to desktop
	if (locals.user) {
		redirect(303, '/');
	}

	return {};
};
