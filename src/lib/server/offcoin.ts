import { OffcoinClient } from '@offcoin/sdk';
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
 * `PUCKSTACK_WORKSPACE_ID` is unset. Puckstack still attaches that legacy alias
 * to newly created members while the transition completes, so the fallback is
 * today's behaviour rather than a failure — but it only resolves for members
 * whose first workspace was ours, so set the variable.
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
