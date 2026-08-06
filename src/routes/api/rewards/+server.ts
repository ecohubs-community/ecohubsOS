import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { isNotNull } from 'drizzle-orm';
import { POLICY, parseGroupsJson, resolveRole } from '$lib/policy';
import { grantReward, listRecentGrants, maxEcoPerGrant, xpGrantedToday } from '$lib/server/rewards';

// GET /api/rewards — everything the granting app needs in one call: who can
// receive, what the caller has left today, and the recent activity.
export const GET: RequestHandler = async ({ locals }) => {
	requireCapability('rewards.grant', locals);

	const [users, recent, usedToday] = await Promise.all([
		db.select().from(userTable).where(isNotNull(userTable.puckstackUserId)),
		listRecentGrants(),
		xpGrantedToday(locals.user.id)
	]);

	// Only people who can actually receive: connected to Offcoin, still here,
	// and not the caller — self-grants are refused server-side anyway, but
	// offering the option would be a worse way to find that out.
	const recipients = users
		.filter((u) => u.membershipStatus !== 'exited' && u.id !== locals.user.id)
		.map((u) => ({
			id: u.id,
			name: u.displayName?.trim() || u.name,
			role: resolveRole(parseGroupsJson(u.groups)),
			level: u.offcoinLevel ?? 0
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	return json({
		recipients,
		recent,
		limits: {
			maxEcoPerGrant: maxEcoPerGrant(),
			ecoToXpRatio: POLICY.grants.ecoToXpRatio,
			xpRemainingToday: Math.max(0, POLICY.grants.maxXpPerActorPerDay - usedToday)
		}
	});
};

// POST /api/rewards — grant ECO and its matching XP.
// Body: { recipientUserId, eco, reason }
export const POST: RequestHandler = async ({ request, locals }) => {
	requireCapability('rewards.grant', locals);

	let body: { recipientUserId?: string; eco?: number; reason?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!body.recipientUserId || typeof body.eco !== 'number' || typeof body.reason !== 'string') {
		error(400, 'recipientUserId, eco and reason are required');
	}

	const result = await grantReward({
		recipientUserId: body.recipientUserId,
		actorUserId: locals.user.id,
		eco: body.eco,
		reason: body.reason
	});

	if (!result.ok) error(400, result.error ?? 'Could not grant');

	return json(result);
};
