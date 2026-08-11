import { describe, it, expect, beforeEach, vi } from 'vitest';

// `$env/dynamic/private` is resolved by SvelteKit at build time; stub it so the
// defaults and the overrides can both be exercised.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/logger', () => ({
	apiLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const { clientIp } = await import('./client-ip');

/** A reverse proxy on the container network — the ordinary deployment. */
const PROXY = '172.18.0.5';
/** A caller reaching the app directly from the internet. */
const DIRECT = '198.51.100.7';

/** Minimal stand-in for the parts of RequestEvent `clientIp` reads. */
function event(headers: Record<string, string>, peer: string | (() => never) = PROXY) {
	return {
		request: new Request('https://os.ecohubs.community/api/auth/sign-in', { headers }),
		getClientAddress: typeof peer === 'function' ? peer : () => peer
	};
}

describe('clientIp', () => {
	beforeEach(() => {
		delete env.ADDRESS_HEADER;
		delete env.XFF_DEPTH;
		delete env.TRUSTED_PROXY_IPS;
	});

	describe('behind a trusted proxy', () => {
		it('reads x-forwarded-for by default, with no configuration', () => {
			expect(clientIp(event({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
		});

		it('takes the address the nearest proxy appended, not the caller-supplied one', () => {
			// A caller sending their own x-forwarded-for prepends to the chain; the
			// rightmost entry is the one our own proxy observed.
			const spoofed = { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' };
			expect(clientIp(event(spoofed))).toBe('203.0.113.9');
		});

		it('counts XFF_DEPTH from the right', () => {
			env.XFF_DEPTH = '2';
			const chain = { 'x-forwarded-for': '1.1.1.1, 203.0.113.9, 172.16.0.1' };
			expect(clientIp(event(chain))).toBe('203.0.113.9');
		});

		it('falls back to the default depth when XFF_DEPTH is not a positive integer', () => {
			env.XFF_DEPTH = 'nonsense';
			expect(clientIp(event({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9');
		});

		it('keys on the proxy, not the caller, when the chain is shorter than XFF_DEPTH', () => {
			// Falling back to the leftmost entry here would hand the caller their
			// own rate-limit key whenever the depth is misconfigured.
			env.XFF_DEPTH = '3';
			expect(clientIp(event({ 'x-forwarded-for': '1.1.1.1' }))).toBe(PROXY);
		});

		it('treats a custom ADDRESS_HEADER as a single value, not a chain', () => {
			env.ADDRESS_HEADER = 'cf-connecting-ip';
			const headers = { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' };
			expect(clientIp(event(headers))).toBe('203.0.113.9');
		});

		it('falls back to the peer address when the header is absent', () => {
			expect(clientIp(event({}))).toBe(PROXY);
		});

		it.each(['127.0.0.1', '10.1.2.3', '192.168.1.1', '::1', '::ffff:172.18.0.5', 'fd00::1'])(
			'trusts a proxy at %s',
			(peer) => {
				expect(clientIp(event({ 'x-forwarded-for': '203.0.113.9' }, peer))).toBe('203.0.113.9');
			}
		);
	});

	describe('from an untrusted peer', () => {
		it('ignores a forged x-forwarded-for and keys on the real connection', () => {
			const forged = { 'x-forwarded-for': '203.0.113.9' };
			expect(clientIp(event(forged, DIRECT))).toBe(DIRECT);
		});

		it('gives a caller the same key however they vary the header', () => {
			// The point of the limiter: a direct caller must not be able to pick a
			// fresh bucket per request.
			const first = clientIp(event({ 'x-forwarded-for': '1.1.1.1' }, DIRECT));
			const second = clientIp(event({ 'x-forwarded-for': '2.2.2.2' }, DIRECT));
			expect(first).toBe(second);
			expect(first).toBe(DIRECT);
		});

		it('ignores a forged custom ADDRESS_HEADER too', () => {
			env.ADDRESS_HEADER = 'cf-connecting-ip';
			expect(clientIp(event({ 'cf-connecting-ip': '203.0.113.9' }, DIRECT))).toBe(DIRECT);
		});

		it('trusts a public proxy once it is named in TRUSTED_PROXY_IPS', () => {
			env.TRUSTED_PROXY_IPS = `198.51.100.1, ${DIRECT}`;
			expect(clientIp(event({ 'x-forwarded-for': '203.0.113.9' }, DIRECT))).toBe('203.0.113.9');
		});
	});

	it('returns a usable key when getClientAddress throws', () => {
		// adapter-node throws when its own ADDRESS_HEADER is set and missing. A
		// limiter that 500s the endpoint it guards is worse than the abuse.
		const throwing = () => {
			throw new Error('Address header was specified but is absent from request');
		};
		expect(clientIp(event({ 'x-forwarded-for': '203.0.113.9' }, throwing))).toBe('unknown');
	});
});
