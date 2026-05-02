import { getOffcoinClient } from '$lib/server/offcoin';
import { NotFoundError } from '@offcoin/sdk';
import { votingLogger } from '$lib/server/logger';

export const PROPOSAL_AUTHOR_MIN_LEVEL = 3;

/**
 * Returns true if the user is eligible to author a new proposal.
 *
 * v1 rule: Offcoin Level >= 3. Requires `puckstackUserId` to be set on the user
 * row (created during onboarding when they connect Offcoin). Users without
 * an Offcoin link are not eligible to author.
 *
 * Voting eligibility is *not* gated by Offcoin (any authenticated user can vote).
 */
export async function canAuthorProposal(user: {
	id: string;
	puckstackUserId: string | null;
}): Promise<boolean> {
	if (!user.puckstackUserId) return false;

	try {
		const offcoin = getOffcoinClient();
		const alias = `puckstack:${user.puckstackUserId}`;
		const xpData = await offcoin.members.getXp(alias);
		return (xpData.level ?? 0) >= PROPOSAL_AUTHOR_MIN_LEVEL;
	} catch (err) {
		if (err instanceof NotFoundError) return false;
		votingLogger.error({ err, userId: user.id }, 'Offcoin level lookup failed');
		return false;
	}
}
