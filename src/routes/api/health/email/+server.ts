import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyEmailConnection } from '$lib/email';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const userGroups: string[] = locals.user.groups
		? JSON.parse(locals.user.groups as unknown as string)
		: [];
	if (!userGroups.includes('EcoHubs Admin')) {
		error(403, 'Forbidden: Admin access required');
	}

	const ok = await verifyEmailConnection();
	return json({ ok }, { status: ok ? 200 : 503 });
};
