import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyWebhookSignature, WebhookEventTypes } from '@offcoin/sdk';
import type { XpUpdatedData } from '@offcoin/sdk';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { user as userTable, membershipEvents } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { POLICY, ROLE_GROUPS, resolveRole } from '$lib/policy';
import { memberAlias, getOffcoinClient } from '$lib/server/offcoin';
import {
	getAuthentikGroupByName,
	getAuthentikUserByEmail,
	addUserToAuthentikGroup
} from '$lib/server/authentik';
import { offcoinLogger } from '$lib/server/logger';
import { recordParticipation } from '$lib/server/participation';

/**
 * POST /api/offcoin/webhook — Offcoin event receiver.
 *
 * Keeps the Offcoin snapshot on `user` fresh and promotes trial members the
 * moment they reach `POLICY.levels.memberFromLevel`. Promotion is applied
 * automatically because it only *grants* rights; every downgrade in this system
 * waits for a human.
 *
 * Always answers 200 once the signature checks out. Offcoin retries on a
 * non-2xx, and a payload we cannot act on (unknown member, unhandled event)
 * will never succeed on a retry — so failing loudly would just generate an
 * endless redelivery loop.
 */
export const POST: RequestHandler = async ({ request }) => {
	const secret = env.OFFCOIN_WEBHOOK_SECRET;
	if (!secret) {
		offcoinLogger.error('OFFCOIN_WEBHOOK_SECRET not configured — rejecting webhook');
		error(500, 'Webhook not configured');
	}

	const signature = request.headers.get('x-webhook-signature');
	const timestamp = request.headers.get('x-webhook-timestamp');
	if (!signature || !timestamp) {
		error(401, 'Missing signature headers');
	}

	// Signature verification needs the RAW body — parsing first would change the
	// bytes the signature was computed over.
	const rawBody = await request.text();

	const verification = await verifyWebhookSignature(rawBody, signature, timestamp, secret);
	if (!verification.valid || !verification.payload) {
		offcoinLogger.warn({ reason: verification.error }, 'Rejected Offcoin webhook signature');
		error(401, 'Invalid signature');
	}

	const { id, type, data } = verification.payload;

	if (type !== WebhookEventTypes.MEMBER_XP_UPDATED) {
		return json({ received: true, handled: false });
	}

	const xp = data as XpUpdatedData;
	const dbUser = await findUserForMember(xp.memberId);

	if (!dbUser) {
		offcoinLogger.warn({ eventId: id, memberId: xp.memberId }, 'No local user for Offcoin member');
		return json({ received: true, handled: false });
	}

	// Snapshot first: this is what every gate reads, and it must stay fresh even
	// if the promotion below fails.
	await db
		.update(userTable)
		.set({
			offcoinMemberId: xp.memberId,
			offcoinXp: xp.newXp,
			offcoinLevel: xp.newLevel,
			offcoinSyncedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(userTable.id, dbUser.id));

	// Earning XP means they did something in Puckstack — the only signal we get
	// for task and meeting activity. Guarded on an actual increase so a
	// re-delivered or zero-amount event cannot fake participation.
	if (xp.newXp > (dbUser.offcoinXp ?? 0)) {
		void recordParticipation(dbUser.id, 'offcoin_xp');
	}

	const promoted = await maybePromote(dbUser, xp);

	return json({ received: true, handled: true, promoted });
};

/**
 * Resolve the local account behind an Offcoin member.
 *
 * The stored `offcoinMemberId` answers this directly once we have seen the
 * member before. The first event for a member arrives with no snapshot yet, so
 * we ask Offcoin for its aliases and read our Puckstack user id back out of the
 * workspace-scoped one.
 */
async function findUserForMember(memberId: string) {
	const bySnapshot = await db.query.user.findFirst({
		where: eq(userTable.offcoinMemberId, memberId)
	});
	if (bySnapshot) return bySnapshot;

	let aliases: string[];
	try {
		const member = await getOffcoinClient().members.get(memberId);
		aliases = member.aliases ?? [];
	} catch (err) {
		offcoinLogger.error({ err, memberId }, 'Could not fetch Offcoin member to resolve user');
		return null;
	}

	// Match the alias we would build ourselves, so a member belonging to a
	// different Puckstack workspace can never resolve to one of our accounts.
	const puckstackUserId = aliases
		.map((alias) => {
			const parts = alias.split(':');
			return parts.length === 3 && parts[0] === 'puckstack' ? parts[2] : null;
		})
		.find((id): id is string => id !== null && aliases.includes(memberAlias(id)));

	if (!puckstackUserId) return null;

	return (
		(await db.query.user.findFirst({
			where: eq(userTable.puckstackUserId, puckstackUserId)
		})) ?? null
	);
}

/**
 * Grant the Member group when a level-up crosses the threshold.
 *
 * Idempotent by construction: it checks the group the user already holds rather
 * than trusting `previousLevel`, so a redelivered event cannot double-apply and
 * a member who somehow skipped the crossing event still gets promoted on their
 * next one.
 */
async function maybePromote(
	dbUser: typeof userTable.$inferSelect,
	xp: XpUpdatedData
): Promise<boolean> {
	if (xp.newLevel < POLICY.levels.memberFromLevel) return false;
	if (dbUser.membershipStatus !== 'active') return false;

	let groups: string[] = [];
	try {
		const parsed = dbUser.groups ? JSON.parse(dbUser.groups) : [];
		groups = Array.isArray(parsed) ? parsed : [];
	} catch {
		groups = [];
	}

	if (groups.includes(ROLE_GROUPS.member)) return false;

	try {
		const groupUuid = await getAuthentikGroupByName(ROLE_GROUPS.member);
		if (!groupUuid) {
			offcoinLogger.error({ group: ROLE_GROUPS.member }, 'Member group missing — cannot promote');
			return false;
		}

		const authentikUserPk = await getAuthentikUserByEmail(dbUser.email);
		if (authentikUserPk === null) {
			offcoinLogger.error({ userId: dbUser.id }, 'No Authentik user — cannot promote');
			return false;
		}

		await addUserToAuthentikGroup(groupUuid, authentikUserPk);

		// Mirror locally so the new rights apply before their next OIDC login.
		const nextGroups = [...groups, ROLE_GROUPS.member];
		await db
			.update(userTable)
			.set({ groups: JSON.stringify(nextGroups), updatedAt: new Date() })
			.where(eq(userTable.id, dbUser.id));

		await db.insert(membershipEvents).values({
			userId: dbUser.id,
			fromRole: resolveRole(groups),
			toRole: resolveRole(nextGroups),
			reason: `Reached Offcoin Level ${xp.newLevel}`,
			actorUserId: null // system-applied
		});

		offcoinLogger.info({ userId: dbUser.id, level: xp.newLevel }, 'Promoted to Member');
		return true;
	} catch (err) {
		offcoinLogger.error({ err, userId: dbUser.id }, 'Promotion failed');
		return false;
	}
}
