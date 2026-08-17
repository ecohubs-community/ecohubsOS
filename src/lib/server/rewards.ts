/**
 * Granting XP and ECO.
 *
 * Two things make this more than a "say thank you" button.
 *
 * XP decides when a trial member becomes a full one, so handing it out is
 * closer to granting rights than to praise — hence the caps, the ban on
 * self-grants, and the requirement for a reason.
 *
 * And a reward that only the giver and receiver see is patronage. Every grant
 * is announced in Discord with who, whom, how much and why, so the community
 * can see how recognition is actually being distributed.
 */

import { db } from '$lib/server/db';
import { rewardGrants, user as userTable } from '$lib/server/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { POLICY } from '$lib/policy';
import { getOffcoinClient, resolveMemberAlias } from '$lib/server/offcoin';
import { sendDiscordMessage } from '$lib/server/discord';
import { recordParticipation } from '$lib/server/participation';
import { apiLogger } from '$lib/server/logger';

const DAY_MS = 86_400_000;

/**
 * XP earned for a given ECO amount.
 *
 * Mirrors Puckstack's task rewards so the same contribution is worth the same
 * wherever it is recognised. Rounds half-up, matching what Puckstack actually
 * awards, and clamps at zero — Offcoin rejects non-positive amounts.
 */
export function xpFromEco(eco: number): number {
	return Math.max(0, Math.round(eco * POLICY.grants.ecoToXpRatio));
}

/** The largest ECO a single grant may carry, given both caps. */
export function maxEcoPerGrant(): number {
	const fromXpCap = Math.floor(POLICY.grants.maxXpPerGrant / POLICY.grants.ecoToXpRatio);
	return Math.min(POLICY.grants.maxEcoPerGrant, fromXpCap);
}

export interface GrantInput {
	recipientUserId: string;
	actorUserId: string;
	eco: number;
	reason: string;
}

export interface GrantResult {
	ok: boolean;
	error?: string;
	grantId?: string;
	eco?: number;
	xp?: number;
	/** True when the XP pushed them over a level boundary. */
	levelledUp?: boolean;
	newLevel?: number;
}

/** XP a steward has already granted today, against the daily cap. */
export async function xpGrantedToday(actorUserId: string, now: Date = new Date()): Promise<number> {
	const since = new Date(now.getTime() - DAY_MS);
	const rows = await db
		.select({ xp: rewardGrants.xp })
		.from(rewardGrants)
		.where(and(eq(rewardGrants.actorUserId, actorUserId), gte(rewardGrants.createdAt, since)));
	return rows.reduce((sum, r) => sum + r.xp, 0);
}

/**
 * Validate and apply a grant.
 *
 * Order matters: everything that can be checked locally is checked before
 * Offcoin is touched, because the ECO and XP calls are two separate writes and
 * a rejection halfway through would leave a member with one and not the other.
 */
export async function grantReward(input: GrantInput): Promise<GrantResult> {
	const eco = Math.floor(input.eco);
	const reason = input.reason.trim();

	// NaN is the one amount that survives every check below — `NaN <= 0`,
	// `NaN > max` and the daily-cap comparison are all false — so it would reach
	// Offcoin with the amount intact, against the guarantee this function's
	// docblock makes. Not reachable through the API, since JSON has no NaN
	// literal, but the function is exported and NaN falls out of arithmetic on a
	// missing field. (±Infinity needs no guard: the checks below already catch
	// both, with better wording than a generic one would give.)
	if (Number.isNaN(eco)) {
		return { ok: false, error: 'Grants must be a positive amount' };
	}

	if (!POLICY.grants.allowNegative && eco <= 0) {
		return { ok: false, error: 'Grants must be a positive amount' };
	}
	if (eco > maxEcoPerGrant()) {
		return { ok: false, error: `A single grant cannot exceed ${maxEcoPerGrant()} ECO` };
	}
	if (reason.length < 5) {
		return { ok: false, error: 'Please say what this is for — it goes in the Discord post' };
	}
	if (!POLICY.grants.allowSelfGrant && input.recipientUserId === input.actorUserId) {
		return { ok: false, error: 'You cannot grant rewards to yourself' };
	}

	const xp = xpFromEco(eco);

	const alreadyToday = await xpGrantedToday(input.actorUserId);
	if (alreadyToday + xp > POLICY.grants.maxXpPerActorPerDay) {
		const left = Math.max(0, POLICY.grants.maxXpPerActorPerDay - alreadyToday);
		return {
			ok: false,
			error: `That would pass your daily limit — ${left} XP left today`
		};
	}

	const [recipient, actor] = await Promise.all([
		db.query.user.findFirst({ where: eq(userTable.id, input.recipientUserId) }),
		db.query.user.findFirst({ where: eq(userTable.id, input.actorUserId) })
	]);

	if (!recipient) return { ok: false, error: 'Member not found' };
	if (!recipient.puckstackUserId) {
		return { ok: false, error: 'This member has not connected Offcoin yet' };
	}
	if (recipient.membershipStatus === 'exited') {
		return { ok: false, error: 'This member has left the community' };
	}

	const offcoin = getOffcoinClient();

	// Settled up front rather than per call: the two grants below are not
	// idempotent, so the alias must not still be in question once ECO has moved.
	let alias: string;
	try {
		alias = await resolveMemberAlias(recipient.puckstackUserId);
	} catch (err) {
		apiLogger.error({ err, recipientId: recipient.id }, 'Offcoin member could not be resolved');
		return { ok: false, error: 'This member has no Offcoin record' };
	}

	let ecoTxId: string | null = null;
	let xpTxId: string | null = null;
	let levelledUp = false;
	let newLevel: number | undefined;

	try {
		// ECO first: it is the reversible half. If XP then fails we have given
		// someone tokens they were owed anyway, rather than rights they were not.
		const tokenResult = await offcoin.members.addTokens(alias, eco, reason);
		ecoTxId = tokenResult.transactionId;

		const xpResult = await offcoin.members.addXp(alias, xp, reason);
		xpTxId = xpResult.transactionId;
		levelledUp = xpResult.level > xpResult.previousLevel;
		newLevel = xpResult.level;

		// Keep the local snapshot fresh so gates and the members list do not lag.
		await db
			.update(userTable)
			.set({
				offcoinXp: xpResult.newXp,
				offcoinLevel: xpResult.level,
				offcoinSyncedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(userTable.id, recipient.id));
	} catch (err) {
		apiLogger.error({ err, recipientId: recipient.id }, 'Offcoin grant failed');
		// Record what did land, so a partial grant is visible rather than lost.
		//
		// Read the transaction ids rather than assuming which half failed: the
		// snapshot update sits after both Offcoin calls, so a database hiccup can
		// throw with the XP already granted. Writing xp: 0 there would understate
		// what the member received and leave room under the actor's daily cap for
		// XP that has already been handed out.
		if (ecoTxId || xpTxId) {
			await db.insert(rewardGrants).values({
				recipientUserId: recipient.id,
				actorUserId: input.actorUserId,
				eco: ecoTxId ? eco : 0,
				xp: xpTxId ? xp : 0,
				reason,
				offcoinEcoTxId: ecoTxId,
				offcoinXpTxId: xpTxId
			});
		}
		return {
			ok: false,
			error: ecoTxId
				? xpTxId
					? 'The grant landed but recording it failed — check Offcoin before regranting'
					: 'The ECO went through but the XP did not — recorded, please check Offcoin'
				: 'Offcoin rejected the grant'
		};
	}

	const [row] = await db
		.insert(rewardGrants)
		.values({
			recipientUserId: recipient.id,
			actorUserId: input.actorUserId,
			eco,
			xp,
			reason,
			offcoinEcoTxId: ecoTxId,
			offcoinXpTxId: xpTxId
		})
		.returning();

	// Receiving recognition is participation — someone did something to earn it.
	void recordParticipation(recipient.id, 'offcoin_xp');

	await announce(row.id, {
		recipient: recipient.displayName?.trim() || recipient.name,
		actor: actor?.displayName?.trim() || actor?.name || 'A steward',
		eco,
		xp,
		reason,
		levelledUp,
		newLevel
	});

	apiLogger.info(
		{ grantId: row.id, recipientId: recipient.id, actorUserId: input.actorUserId, eco, xp },
		'Reward granted'
	);

	return { ok: true, grantId: row.id, eco, xp, levelledUp, newLevel };
}

/**
 * Post the grant to Discord.
 *
 * Best-effort: a Discord outage must not undo a grant that already landed in
 * Offcoin. `announcedAt` records whether it got through, so a missing post is
 * visible rather than assumed.
 */
async function announce(
	grantId: string,
	detail: {
		recipient: string;
		actor: string;
		eco: number;
		xp: number;
		reason: string;
		levelledUp: boolean;
		newLevel?: number;
	}
): Promise<void> {
	const lines = [
		`🌱 **${detail.actor}** recognised **${detail.recipient}** — ${detail.eco} ECO / ${detail.xp} XP`,
		`> ${detail.reason}`
	];
	if (detail.levelledUp && detail.newLevel !== undefined) {
		lines.push(`🎉 That takes ${detail.recipient} to **Level ${detail.newLevel}**.`);
	}

	try {
		const ok = await sendDiscordMessage({ content: lines.join('\n') });
		if (ok) {
			await db
				.update(rewardGrants)
				.set({ announcedAt: new Date() })
				.where(eq(rewardGrants.id, grantId));
		}
	} catch (err) {
		apiLogger.error({ err, grantId }, 'Grant announcement failed');
	}
}

export interface GrantRow {
	id: string;
	recipientName: string;
	actorName: string;
	eco: number;
	xp: number;
	reason: string;
	announced: boolean;
	createdAt: string | null;
}

/** Recent grants, for the app's activity list. */
export async function listRecentGrants(limit = 25): Promise<GrantRow[]> {
	const rows = await db
		.select()
		.from(rewardGrants)
		.orderBy(desc(rewardGrants.createdAt))
		.limit(limit);
	if (rows.length === 0) return [];

	const users = await db.select().from(userTable);
	const nameOf = (id: string) => {
		const u = users.find((x) => x.id === id);
		return u ? u.displayName?.trim() || u.name : 'Unknown';
	};

	return rows.map((r) => ({
		id: r.id,
		recipientName: nameOf(r.recipientUserId),
		actorName: nameOf(r.actorUserId),
		eco: r.eco,
		xp: r.xp,
		reason: r.reason,
		announced: !!r.announcedAt,
		createdAt: r.createdAt?.toISOString() ?? null
	}));
}
