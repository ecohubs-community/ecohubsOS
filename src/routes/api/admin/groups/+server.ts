import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/authz';
import { MANAGEABLE_GROUPS, setGroupMembership } from '$lib/server/group-grants';

// GET /api/admin/groups — which groups this endpoint is willing to manage.
// The UI builds its toggles from this rather than hardcoding names, so the
// allowlist stays the single source of truth.
export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	return json({
		groups: Object.entries(MANAGEABLE_GROUPS).map(([group, meta]) => ({ group, ...meta }))
	});
};

// POST /api/admin/groups — add or remove one allowlisted group.
// Body: { userId, group, action: 'add' | 'remove' }
//
// Replaces the single-purpose /api/admin/stewards, which only knew one group.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);

	let body: { userId?: string; group?: string; action?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!body.userId || !body.group || (body.action !== 'add' && body.action !== 'remove')) {
		error(400, 'userId, group and action ("add"|"remove") are required');
	}

	const result = await setGroupMembership({
		userId: body.userId,
		group: body.group,
		action: body.action,
		actorUserId: locals.user.id
	});

	if (!result.ok) error(400, result.error ?? 'Could not update group');

	return json({ success: true, groups: result.groups });
};
