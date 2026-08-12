/**
 * Local sign-out leaves Authentik's own session alive, so the next sign-in is
 * answered silently and the member appears never to have logged out. These
 * cover the URL that ends it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/logger', () => ({
	authentikLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const DISCOVERY = {
	end_session_endpoint: 'https://sso.example.com/application/o/ecohubs-os/end-session/'
};

beforeEach(() => {
	vi.resetModules();
	vi.unstubAllGlobals();
	env.AUTHENTIK_ISSUER_URL = 'https://sso.example.com/application/o/ecohubs-os';
});

/** Fresh import per test so the module-level discovery cache starts empty. */
async function load() {
	return (await import('./authentik')).buildSsoLogoutUrl;
}

function stubDiscovery(body: unknown, ok = true) {
	const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('buildSsoLogoutUrl', () => {
	it('carries the id token so Authentik skips its confirmation page', async () => {
		stubDiscovery(DISCOVERY);
		const build = await load();

		const url = new URL((await build('tok-123', 'https://os.example.com/login'))!);
		expect(url.origin + url.pathname).toBe(
			'https://sso.example.com/application/o/ecohubs-os/end-session/'
		);
		expect(url.searchParams.get('id_token_hint')).toBe('tok-123');
		expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://os.example.com/login');
	});

	it('still logs out when no id token was stored', async () => {
		// Without the hint Authentik shows a confirmation page rather than
		// redirecting back — degraded, but the session still ends.
		stubDiscovery(DISCOVERY);
		const build = await load();

		const url = new URL((await build(null, 'https://os.example.com/login'))!);
		expect(url.searchParams.has('id_token_hint')).toBe(false);
		expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://os.example.com/login');
	});

	it('reads discovery once, not on every logout', async () => {
		const fetchMock = stubDiscovery(DISCOVERY);
		const build = await load();

		await build('a', 'https://os.example.com/login');
		await build('b', 'https://os.example.com/login');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('returns null rather than throwing when discovery is unreachable', async () => {
		// The caller falls back to a local-only sign-out. Refusing to log out at
		// all because the identity provider could not be asked is the worse
		// failure.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		const build = await load();

		expect(await build('tok', 'https://os.example.com/login')).toBeNull();
	});

	it('returns null when the provider advertises no end_session_endpoint', async () => {
		stubDiscovery({ issuer: 'https://sso.example.com/' });
		const build = await load();

		expect(await build('tok', 'https://os.example.com/login')).toBeNull();
	});

	it('returns null when the issuer is not configured', async () => {
		delete env.AUTHENTIK_ISSUER_URL;
		stubDiscovery(DISCOVERY);
		const build = await load();

		expect(await build('tok', 'https://os.example.com/login')).toBeNull();
	});
});
