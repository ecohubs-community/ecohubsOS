import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReactivationStatus } from '$lib/server/membership-reactivation';
import { getOpenCaseFor } from '$lib/server/membership-cases';

// The gated shell a standby member sees instead of the desktop.
//
// Standby keeps `os.access` precisely so there is a route in to ask for
// reactivation; without it there would be no way back short of email.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');

	// Anyone not on standby has no business here.
	if (locals.user.membershipStatus !== 'standby') redirect(303, '/');

	const status = await getReactivationStatus(locals.user.id, locals.user.email);

	// A member suspended pending a disciplinary case is on standby too, but they
	// did not choose to pause and cannot request reactivation — the community is
	// already deciding. They see the case state instead of the request form.
	const openCase = await getOpenCaseFor(locals.user.id);

	return {
		displayName: locals.user.displayName || locals.user.name,
		standbyReason: locals.user.standbyReason,
		reactivation: status,
		// Only whether a case is open and what stage it is at. The summary is for
		// voters and the notes are for stewards; neither belongs here.
		openCase: openCase ? { status: openCase.status } : null
	};
};
