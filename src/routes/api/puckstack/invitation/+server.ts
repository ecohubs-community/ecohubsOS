import { json, type RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { puckstackLogger } from '$lib/server/logger';
import { resolvePuckstackIdentity } from '$lib/server/puckstack-identity';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

interface InvitationRequestBody {
	inviteToken?: string;
}

/**
 * Proxy endpoint to generate a Puckstack workspace invitation.
 * Also: when Puckstack reports the user is already a member, capture
 * their Puckstack User ID and persist it on the local user record so
 * the linking flow can use it without asking the member for anything.
 */
export const POST: RequestHandler = async ({ request }) => {
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	// Optional client-supplied inviteToken — overrides the DB value if
	// provided. Useful if a stored token went bad and the user has a
	// fresher one in hand.
	let body: InvitationRequestBody = {};
	try {
		body = (await request.json()) as InvitationRequestBody;
	} catch {
		// No body / malformed body — proceed with stored token (if any).
	}
	const clientToken = typeof body.inviteToken === 'string' ? body.inviteToken : undefined;

	// Pull the persisted invitation token from the user record so we
	// survive component remounts, browser restarts, and device switches.
	const [dbUser] = await db
		.select({ puckstackInviteToken: user.puckstackInviteToken })
		.from(user)
		.where(eq(user.id, session.user.id));
	const storedToken = dbUser?.puckstackInviteToken ?? undefined;

	// Resolution is keyed on the session's email, never on anything the caller
	// sends — the same guarantee the Offcoin link now depends on.
	const identity = await resolvePuckstackIdentity(session.user.email, clientToken ?? storedToken);

	if (identity.kind === 'error') {
		return json({ success: false, error: identity.message }, { status: identity.status });
	}

	if (identity.kind === 'member') {
		// Persist the Puckstack User ID and clear the now-redundant
		// invite token so future calls don't keep retrying it.
		try {
			await db
				.update(user)
				.set({
					puckstackUserId: identity.userId,
					puckstackInviteToken: null,
					updatedAt: new Date()
				})
				.where(eq(user.id, session.user.id));
		} catch (dbErr) {
			puckstackLogger.error(
				{ err: dbErr, userId: session.user.id, puckstackUserId: identity.userId },
				'Failed to persist puckstackUserId (non-fatal)'
			);
		}

		return json({
			success: true,
			alreadyMember: true,
			workspaceUrl: identity.workspaceUrl,
			puckstackUserId: identity.userId
		});
	}

	// Persist the new (or refreshed) token so it survives across
	// sessions, devices, and component remounts.
	try {
		await db
			.update(user)
			.set({
				puckstackInviteToken: identity.token,
				updatedAt: new Date()
			})
			.where(eq(user.id, session.user.id));
	} catch (dbErr) {
		puckstackLogger.error(
			{ err: dbErr, userId: session.user.id },
			'Failed to persist puckstackInviteToken (non-fatal)'
		);
	}

	return json({
		success: true,
		joinUrl: identity.joinUrl,
		inviteToken: identity.token,
		expiresAt: identity.expiresAt
	});
};
