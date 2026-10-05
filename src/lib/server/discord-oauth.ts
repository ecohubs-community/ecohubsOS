/**
 * Shared bits of the Discord OAuth onboarding step.
 */

/** httpOnly cookie holding the CSRF nonce between /auth and /callback. */
export const DISCORD_STATE_COOKIE = 'discord_oauth_state';

/** Only same-site paths — `//evil.com` is protocol-relative, so refuse it too. */
export function safeReturnTo(raw: unknown): string {
	return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

/**
 * Decode `state` and check it against the cookie nonce. Returns null for
 * anything that does not match, so the caller has one refusal path.
 */
export function readDiscordState(
	state: string | null,
	cookieNonce: string | undefined
): { returnTo: string } | null {
	if (!state || !cookieNonce) return null;
	try {
		const data = JSON.parse(Buffer.from(state, 'base64url').toString());
		if (typeof data?.nonce !== 'string' || data.nonce !== cookieNonce) return null;
		return { returnTo: safeReturnTo(data.returnTo) };
	} catch {
		return null;
	}
}
