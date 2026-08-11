import { describe, it, expect, beforeEach, vi } from 'vitest';

// `$env/dynamic/private` is resolved by SvelteKit at build time; stub it so the
// defaults and the overrides can both be exercised.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/logger', () => ({
	apiLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const { clientIp } = await import('./client-ip');

/** Minimal stand-in for the parts of RequestEvent `clientIp` reads. */
function event(headers: Record<string, string>, socketAddress: string | (() => never) = '10.0.0.1') {
	return {
		request: new Request('https://os.ecohubs.community/api/auth/sign-in', { headers }),
		getClientAddress: typeof socketAddress === 'function' ? socketAddress : () => socketAddress
	};
}

describe('clientIp', () => {
	beforeEach(() => {
		delete env.ADDRESS_HEADER;
		delete env.XFF_DEPTH;
	});

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

	it('does not throw when the chain is shorter than XFF_DEPTH', () => {
		env.XFF_DEPTH = '3';
		expect(clientIp(event({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
	});

	it('treats a custom ADDRESS_HEADER as a single value, not a chain', () => {
		env.ADDRESS_HEADER = 'cf-connecting-ip';
		const headers = { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' };
		expect(clientIp(event(headers))).toBe('203.0.113.9');
	});

	it('falls back to the socket address when the header is absent', () => {
		expect(clientIp(event({}))).toBe('10.0.0.1');
	});

	it('returns a usable key when getClientAddress throws', () => {
		// adapter-node throws when its own ADDRESS_HEADER is set and missing. A
		// limiter that 500s the endpoint it guards is worse than the abuse.
		const throwing = () => {
			throw new Error('Address header was specified but is absent from request');
		};
		expect(clientIp(event({}, throwing))).toBe('unknown');
	});
});
