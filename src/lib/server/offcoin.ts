import { OffcoinClient, NotFoundError } from '@offcoin/sdk';
import { env } from '$env/dynamic/private';
import { offcoinLogger } from '$lib/server/logger';

let client: OffcoinClient | null = null;

/** Warn once per process rather than on every alias built. */
let warnedMissingWorkspaceId = false;

/**
 * Offcoin member alias for a Puckstack user.
 *
 * Puckstack scopes members per workspace as `puckstack:{workspaceId}:{userId}`,
 * because ECO and XP belong to the economy they were earned in. We must address
 * members the same way or we look up the wrong row — or none at all.
 *
 * Falls back to the pre-scoping `puckstack:{userId}` when
 * `PUCKSTACK_WORKSPACE_ID` is unset. **Set the variable.** Puckstack no longer
 * attaches that legacy alias to new members, and the ones that still carry it
 * are pre-scoping members which Puckstack now adopts into whichever workspace
 * asks for them first. So the fallback resolves for a shrinking set of members
 * and, worse, may resolve to a member that has since been adopted by a
 * different workspace — crediting a grant to an economy that is not ours.
 */
export function memberAlias(puckstackUserId: string): string {
	const workspaceId = env.PUCKSTACK_WORKSPACE_ID;

	if (!workspaceId) {
		if (!warnedMissingWorkspaceId) {
			warnedMissingWorkspaceId = true;
			offcoinLogger.warn(
				'PUCKSTACK_WORKSPACE_ID is not set — falling back to the legacy unscoped Offcoin alias. ' +
					'Members whose first Puckstack workspace was not ours will not resolve.'
			);
		}
		return `puckstack:${puckstackUserId}`;
	}

	return `puckstack:${workspaceId}:${puckstackUserId}`;
}

/**
 * Every alias a member of ours might be addressable by, best first.
 *
 * Puckstack scoped its aliases part-way through the community's life and did not
 * backfill: members created before the change carry only `puckstack:{userId}`,
 * members created after carry only the scoped form, and the handful who were
 * touched during the transition carry both. Building one alias therefore picks a
 * side, and whichever side we pick the other group stops resolving — their XP
 * and level silently read as nothing.
 *
 * So we ask for both. The scoped alias is tried first because it is the one that
 * cannot be claimed by another workspace; the legacy alias is a fallback for the
 * members Puckstack never migrated, not a preference.
 */
export function memberAliases(puckstackUserId: string): string[] {
	const scoped = memberAlias(puckstackUserId);
	const legacy = `puckstack:${puckstackUserId}`;
	return scoped === legacy ? [legacy] : [scoped, legacy];
}

/**
 * Read the Puckstack user id back out of an alias, in either shape.
 *
 * Returns null for aliases that are not ours — a `discord:` or `wallet:` alias,
 * or a `puckstack:` alias scoped to a workspace that is not the one we address
 * members in.
 */
export function parsePuckstackUserId(alias: string): string | null {
	const parts = alias.split(':');
	if (parts[0] !== 'puckstack') return null;

	if (parts.length === 2) return parts[1] || null;

	if (parts.length === 3) {
		const workspaceId = env.PUCKSTACK_WORKSPACE_ID;
		// With no workspace configured we cannot tell our scoped aliases from
		// another workspace's, and guessing wrong attaches someone else's economy
		// to one of our accounts. Refusing is the safe half of that trade.
		if (!workspaceId || parts[1] !== workspaceId) return null;
		return parts[2] || null;
	}

	return null;
}

/**
 * Run an Offcoin operation against whichever alias the member actually holds.
 *
 * Tries each candidate in turn and moves on only when Offcoin says the member
 * does not exist, so a 404 for the scoped alias falls through to the legacy one
 * instead of surfacing as "this member has no XP". Every other error propagates
 * untouched — a network failure is not evidence about which alias is right.
 *
 * Safe for writes as well as reads: a `NotFoundError` means the call had no
 * effect, so the retry cannot double-apply a grant.
 */
export async function withMemberAlias<T>(
	puckstackUserId: string,
	op: (alias: string) => Promise<T>
): Promise<T> {
	const aliases = memberAliases(puckstackUserId);
	let lastNotFound: unknown;

	for (const alias of aliases) {
		try {
			return await op(alias);
		} catch (err) {
			if (!(err instanceof NotFoundError)) throw err;
			lastNotFound = err;
		}
	}

	throw lastNotFound;
}

/**
 * The alias this member actually resolves by, settled before anything is written.
 *
 * `withMemberAlias` retries the operation it wraps, which is right for a single
 * call and wrong for a sequence that has already changed something — a grant
 * that credited ECO and then hit a 404 must not credit it a second time under
 * the next alias. Callers making more than one write resolve first and then use
 * the answer, trading one extra read for the guarantee.
 *
 * Throws `NotFoundError` when no alias resolves.
 */
export async function resolveMemberAlias(puckstackUserId: string): Promise<string> {
	return withMemberAlias(puckstackUserId, async (alias) => {
		await getOffcoinClient().members.get(alias);
		return alias;
	});
}

export function getOffcoinClient(): OffcoinClient {
	if (!client) {
		const clientId = env.OFFCOIN_CLIENT_ID;
		const clientSecret = env.OFFCOIN_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error('OFFCOIN_CLIENT_ID and OFFCOIN_CLIENT_SECRET must be set');
		}

		client = new OffcoinClient({
			baseUrl: 'https://offcoin.space',
			clientId,
			clientSecret
		});
	}
	return client;
}
