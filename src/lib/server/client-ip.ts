/**
 * Resolving the real client IP behind a reverse proxy.
 *
 * adapter-node can do this via its own `ADDRESS_HEADER`/`XFF_DEPTH` variables,
 * but it reads them from `process.env` at server startup and throws outright
 * when the header is configured and missing. That leaves no room for a default:
 * an unset `ADDRESS_HEADER` silently reports the socket peer address, which
 * behind a proxy is the *proxy* for every member — one shared rate-limit bucket
 * for the whole community, which is exactly how logout came to 429.
 *
 * So we resolve it here instead, with working defaults and the same variable
 * names as overrides.
 *
 * The load-bearing rule is that **a forwarding header is only evidence when it
 * comes from a proxy we put there ourselves**. Anyone can send
 * `x-forwarded-for`; if we read it from whoever connects, a caller reaching the
 * app directly picks a fresh rate-limit bucket per request and the limiter stops
 * meaning anything. So the socket peer is checked first, and callers we do not
 * recognise are keyed on the address they actually connected from — which they
 * cannot choose.
 */

import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { apiLogger } from '$lib/server/logger';

/** Overridden by `ADDRESS_HEADER`. */
const DEFAULT_ADDRESS_HEADER = 'x-forwarded-for';

/**
 * Overridden by `XFF_DEPTH`: the number of trusted proxies in front of the app.
 *
 * The depth is counted from the *right* of the chain, because only the entries
 * your own proxies appended are trustworthy — everything to their left was sent
 * by the caller and can say anything. One proxy is the common deployment, and
 * with `1` the value we read is the address the nearest proxy observed.
 *
 * Setting this higher than the number of proxies you actually run hands callers
 * the ability to choose their own rate-limit bucket by sending the header
 * themselves.
 */
const DEFAULT_XFF_DEPTH = 1;

/** Used when no address can be resolved at all, so callers always get a key. */
const UNKNOWN = 'unknown';

function xffDepth(): number {
	const raw = env.XFF_DEPTH;
	if (!raw) return DEFAULT_XFF_DEPTH;

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		apiLogger.warn(
			{ XFF_DEPTH: raw, using: DEFAULT_XFF_DEPTH },
			'XFF_DEPTH must be a positive integer; falling back to the default'
		);
		return DEFAULT_XFF_DEPTH;
	}
	return parsed;
}

/**
 * Loopback and RFC1918/RFC4193 ranges — where a reverse proxy sharing the host
 * or the container network connects from. This is the default trust rule
 * precisely because it needs no configuration to be correct for the ordinary
 * deployment, and a misconfigured allowlist that silently trusts the internet
 * would be worse than no allowlist at all.
 */
function isPrivateAddress(ip: string): boolean {
	// IPv4-mapped IPv6, e.g. ::ffff:172.18.0.5
	const addr = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;

	const octets = addr.split('.');
	if (octets.length === 4) {
		const [a, b] = octets.map(Number);
		if (Number.isNaN(a) || Number.isNaN(b)) return false;
		if (a === 127) return true; // 127.0.0.0/8 loopback
		if (a === 10) return true; // 10.0.0.0/8
		if (a === 192 && b === 168) return true; // 192.168.0.0/16
		if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
		return false;
	}

	const v6 = addr.toLowerCase();
	if (v6 === '::1') return true; // loopback
	if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7 unique-local
	return /^fe[89ab]/.test(v6); // fe80::/10 link-local
}

/**
 * Whether a forwarding header from this peer should be believed.
 *
 * `TRUSTED_PROXY_IPS` is the escape hatch for a proxy that reaches us over a
 * public address — a load balancer on another host, say — where the private
 * default cannot recognise it.
 */
function isTrustedPeer(peer: string | null): boolean {
	if (!peer) return false;

	const configured = (env.TRUSTED_PROXY_IPS || '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (configured.includes(peer)) return true;

	return isPrivateAddress(peer);
}

/** The socket peer, or null when adapter-node cannot report one. */
function peerAddress(event: Pick<RequestEvent, 'getClientAddress'>): string | null {
	try {
		return event.getClientAddress() || null;
	} catch {
		// adapter-node throws when its own ADDRESS_HEADER is set and the header is
		// absent. A limiter that 500s the endpoint it guards is worse than the
		// abuse it prevents.
		return null;
	}
}

/**
 * The client IP to key rate limits on.
 *
 * Never throws — unresolvable callers share the `unknown` bucket rather than
 * taking the request down with them.
 */
export function clientIp(event: Pick<RequestEvent, 'request' | 'getClientAddress'>): string {
	const peer = peerAddress(event);

	// Untrusted peer: key on where they actually connected from. Their
	// forwarding headers, if any, are ignored.
	if (!isTrustedPeer(peer)) return peer ?? UNKNOWN;

	const header = (env.ADDRESS_HEADER || DEFAULT_ADDRESS_HEADER).toLowerCase();
	const raw = event.request.headers.get(header);
	if (!raw) return peer ?? UNKNOWN;

	// Only x-forwarded-for carries a chain; any other header is a single value.
	if (header !== 'x-forwarded-for') return raw.trim() || (peer ?? UNKNOWN);

	const addresses = raw.split(',');
	const depth = xffDepth();

	if (depth > addresses.length) {
		// The proxy count is wrong, or something reached us without passing
		// through every hop. Falling back to the leftmost entry would hand the
		// caller the key, so fall back to the proxy instead: members behind it
		// share a bucket, which is the old behaviour rather than a new hole.
		apiLogger.warn(
			{ depth, found: addresses.length },
			'x-forwarded-for is shorter than XFF_DEPTH; keying on the proxy address'
		);
		return peer ?? UNKNOWN;
	}

	return addresses[addresses.length - depth].trim() || (peer ?? UNKNOWN);
}
