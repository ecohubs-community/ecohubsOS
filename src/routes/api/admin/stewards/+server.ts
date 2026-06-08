import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, STEWARD_GROUP } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	addUserToAuthentikGroup,
	removeUserFromAuthentikGroup
} from '$lib/server/authentik';
import { apiLogger } from '$lib/server/logger';

// POST — add or remove a user from the "EcoHubs Steward" group (admin only).
// Body: { userId, action: 'add' | 'remove' }
//
// Authentik is the source of truth, but its group claim only refreshes on the
// user's next OIDC login. We therefore ALSO mirror the change into the local
// user.groups JSON so app gating takes effect immediately.
export const POST: RequestHandler = async ({ locals, request }) => {
	requireAdmin(locals);

	const { userId, action } = await request.json();
	if (!userId || (action !== 'add' && action !== 'remove')) {
		error(400, 'userId and action ("add"|"remove") are required');
	}

	const target = await db.query.user.findFirst({ where: eq(userTable.id, userId) });
	if (!target) error(404, 'User not found');

	// 1. Resolve Authentik group + user.
	let groupUuid: string | null;
	let authentikUserPk: number | null;
	try {
		groupUuid = await getAuthentikGroupByName(STEWARD_GROUP);
		if (!groupUuid) error(500, `Authentik group "${STEWARD_GROUP}" not found`);
		authentikUserPk = await getAuthentikUserByEmail(target.email);
		if (authentikUserPk === null) error(404, `Authentik user not found for ${target.email}`);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err; // re-throw SvelteKit errors
		apiLogger.error({ err, userId }, 'Authentik lookup failed during steward toggle');
		error(500, `Authentik lookup failed: ${err instanceof Error ? err.message : 'Unknown'}`);
	}

	// 2. Apply in Authentik.
	try {
		if (action === 'add') {
			await addUserToAuthentikGroup(groupUuid, authentikUserPk);
		} else {
			await removeUserFromAuthentikGroup(groupUuid, authentikUserPk);
		}
	} catch (err) {
		apiLogger.error({ err, userId, action }, 'Authentik group update failed');
		error(500, `Authentik update failed: ${err instanceof Error ? err.message : 'Unknown'}`);
	}

	// 3. Mirror locally for immediate effect.
	let groups: string[] = [];
	try {
		groups = target.groups ? JSON.parse(target.groups) : [];
		if (!Array.isArray(groups)) groups = [];
	} catch {
		groups = [];
	}
	if (action === 'add' && !groups.includes(STEWARD_GROUP)) groups.push(STEWARD_GROUP);
	if (action === 'remove') groups = groups.filter((g) => g !== STEWARD_GROUP);

	await db
		.update(userTable)
		.set({ groups: JSON.stringify(groups), updatedAt: new Date() })
		.where(eq(userTable.id, userId));

	apiLogger.info({ userId, action }, 'Steward membership updated');
	return json({ success: true, groups });
};
