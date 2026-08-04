import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReactivationStatus } from '$lib/server/membership-reactivation';

// The gated shell a standby member sees instead of the desktop.
//
// Standby keeps `os.access` precisely so there is a route in to ask for
// reactivation; without it there would be no way back short of email.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');

	// Anyone not on standby has no business here.
	if (locals.user.membershipStatus !== 'standby') redirect(303, '/');

	const status = await getReactivationStatus(locals.user.id, locals.user.email);

	return {
		displayName: locals.user.displayName || locals.user.name,
		standbyReason: locals.user.standbyReason,
		reactivation: status
	};
};
