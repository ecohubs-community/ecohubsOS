import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyWebhookSignature, WebhookEventTypes } from '@offcoin/sdk';
import type { XpUpdatedData } from '@offcoin/sdk';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { parsePuckstackUserId, getOffcoinClient } from '$lib/server/offcoin';
import { promoteIfEligible } from '$lib/server/promotion';
import { offcoinLogger } from '$lib/server/logger';
import { recordParticipation } from '$lib/server/participation';

/**
 * POST /api/offcoin/webhook — Offcoin event receiver.
 *
 * Keeps the Offcoin snapshot on `user` fresh and promotes trial members the
 * moment they reach `POLICY.levels.memberFromLevel` (via `promoteIfEligible`,
 * which every other level read calls too). Promotion is applied
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

	const promoted = (await promoteIfEligible(dbUser.id, xp.newLevel)).kind === 'promoted';

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

	// Accept either alias shape. Reading only the scoped one lost every member
	// Puckstack created before it started scoping — the first XP event for them
	// resolved to no local user, so the snapshot was never written and the
	// level-up that should have promoted them was dropped on the floor. The
	// workspace check still lives in `parsePuckstackUserId`, so a member of
	// another workspace is rejected exactly as before.
	const puckstackUserId = aliases
		.map(parsePuckstackUserId)
		.find((id): id is string => id !== null);

	if (!puckstackUserId) return null;

	return (
		(await db.query.user.findFirst({
			where: eq(userTable.puckstackUserId, puckstackUserId)
		})) ?? null
	);
}
