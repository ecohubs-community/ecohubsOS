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
 * names as overrides. `getClientAddress()` stays as the fallback for requests
 * that genuinely arrive without the header — local dev, container health checks.
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
 * The client IP to key rate limits on.
 *
 * Never throws — a limiter that 500s the endpoint it guards is worse than the
 * abuse it prevents. Unresolvable callers share the `unknown` bucket.
 */
export function clientIp(event: Pick<RequestEvent, 'request' | 'getClientAddress'>): string {
	const header = (env.ADDRESS_HEADER || DEFAULT_ADDRESS_HEADER).toLowerCase();
	const raw = event.request.headers.get(header);

	if (raw) {
		// Only x-forwarded-for carries a chain; any other header is a single value.
		if (header !== 'x-forwarded-for') return raw.trim();

		const addresses = raw.split(',');
		const depth = xffDepth();
		const picked = addresses[addresses.length - depth]?.trim();
		if (picked) return picked;

		// Chain shorter than the configured depth — the proxy count is wrong, or
		// something reached us without passing through every hop. Take the
		// leftmost entry and say so, rather than throwing the way adapter-node
		// would.
		apiLogger.warn(
			{ depth, found: addresses.length },
			'x-forwarded-for is shorter than XFF_DEPTH; using the leftmost address'
		);
		return addresses[0].trim() || UNKNOWN;
	}

	// No header: a direct connection. `getClientAddress()` throws if adapter-node
	// has its own ADDRESS_HEADER set and this request lacks it.
	try {
		return event.getClientAddress();
	} catch {
		return UNKNOWN;
	}
}
