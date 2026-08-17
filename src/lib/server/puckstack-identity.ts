/**
 * Who a member is on Puckstack — established by Puckstack, not claimed by the
 * caller.
 *
 * This exists because the Puckstack user id decides where a grant lands, whose
 * member an exit deletes, and which level the gates read. Taking it from a
 * request body meant an authenticated member could name someone else's id and,
 * as long as nobody had linked it yet, attach their own wallet to that person's
 * economy. The id was never a secret — it is visible in the workspace — so the
 * only thing standing between an account and someone else's rewards was that
 * nobody had tried.
 *
 * `auto-generate` is the fix because it is keyed on the caller's *email*: we
 * hand Puckstack the session's address and Puckstack tells us which of its users
 * that is. The caller never gets to choose. The Puckstack signup flow has always
 * worked this way — this puts the linking flow on the same footing.
 */

import { env } from '$env/dynamic/private';
import { puckstackLogger } from '$lib/server/logger';

interface AlreadyMemberResponse {
	success: true;
	alreadyMember: true;
	user: { id: string };
	workspace: { slug: string; name: string; url: string };
}

interface InvitationResponse {
	success: true;
	invitation: { token: string; joinUrl: string; expiresAt: string; role: string };
}

type AutoGenerateResponse = AlreadyMemberResponse | InvitationResponse | { success: false; error?: string };

function isAlreadyMember(data: AutoGenerateResponse): data is AlreadyMemberResponse {
	return data.success === true && 'alreadyMember' in data && data.alreadyMember === true;
}

function isInvitation(data: AutoGenerateResponse): data is InvitationResponse {
	return data.success === true && 'invitation' in data;
}

/**
 * The outcome of asking Puckstack who an email belongs to.
 *
 * `member` is the only answer that establishes identity. `invitation` means
 * Puckstack has never seen them — it mints a join link as a side effect, which
 * is exactly what a caller in that position needs next.
 */
export type PuckstackIdentity =
	| { kind: 'member'; userId: string; workspaceUrl: string }
	| { kind: 'invitation'; token: string; joinUrl: string; expiresAt: string }
	/** Never throws: callers decide whether a Puckstack outage is fatal to them. */
	| { kind: 'error'; status: number; message: string };

/**
 * Ask Puckstack to resolve `email`, minting a workspace invitation if it is not
 * a member yet.
 *
 * `inviteToken` reuses a previously issued invitation rather than stacking up
 * new ones for the same person.
 */
export async function resolvePuckstackIdentity(
	email: string,
	inviteToken?: string
): Promise<PuckstackIdentity> {
	const puckstackApiUrl = env.PUCKSTACK_API_URL;
	const puckstackApiKey = env.PUCKSTACK_API_KEY;

	if (!puckstackApiUrl || !puckstackApiKey) {
		puckstackLogger.error('PUCKSTACK_API_URL or PUCKSTACK_API_KEY not configured');
		return { kind: 'error', status: 500, message: 'Puckstack integration not configured' };
	}

	let response: Response;
	try {
		response = await fetch(`${puckstackApiUrl}/invitations/auto-generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${puckstackApiKey}`
			},
			body: JSON.stringify({
				workspaceSlug: 'ecohubs',
				email,
				...(inviteToken ? { inviteToken } : {})
			})
		});
	} catch (err) {
		puckstackLogger.error({ err }, 'Network error reaching Puckstack');
		return { kind: 'error', status: 502, message: 'Could not reach Puckstack' };
	}

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
		puckstackLogger.error({ status: response.status, errorData }, 'Puckstack invitation API error');
		return {
			kind: 'error',
			status: response.status,
			message: errorData.error || 'Failed to generate invitation'
		};
	}

	const data = (await response.json()) as AutoGenerateResponse;

	if (isAlreadyMember(data)) {
		return { kind: 'member', userId: data.user.id, workspaceUrl: data.workspace.url };
	}

	if (isInvitation(data)) {
		return {
			kind: 'invitation',
			token: data.invitation.token,
			joinUrl: data.invitation.joinUrl,
			expiresAt: data.invitation.expiresAt
		};
	}

	puckstackLogger.error({ data }, 'Unexpected auto-generate response shape');
	return { kind: 'error', status: 502, message: 'Unexpected response from Puckstack' };
}
