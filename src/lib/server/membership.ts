/**
 * Server-side membership enforcement.
 *
 * `$lib/policy` decides and describes; this module is the half that throws.
 * Endpoints should reach for `requireCapability()` rather than hand-rolling
 * group checks, so that what the server enforces and what the UI explains can
 * never drift apart.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	can,
	resolveRole,
	type Capability,
	type CapabilityResult,
	type MemberContext,
	type MembershipStatus,
	type Role
} from '$lib/policy';
import { parseGroups } from '$lib/server/authz';

type Locals = RequestEvent['locals'];

/**
 * Build the policy context for the current request.
 *
 * `level` comes from the Offcoin snapshot on the user row, never a live Offcoin
 * call — an outage must not be able to demote anyone. It also never decides an
 * allow/deny on its own: authorization is settled by Authentik group
 * membership, so a stale snapshot can only make a denial *message* imprecise.
 *
 * `status` defaults to `active` only for the anonymous case; every account row
 * has the column with an `active` default.
 */
export function getMemberContext(
	locals: Locals,
	overrides: Partial<MemberContext> = {}
): MemberContext {
	return {
		groups: parseGroups(locals),
		status: locals.user?.membershipStatus ?? 'active',
		level: locals.user?.offcoinLevel ?? 0,
		...overrides
	};
}

/**
 * Evaluate a capability without throwing. Use when the endpoint wants to shape
 * its own response — e.g. returning the denial reason so the client can render a
 * "Request access" button for `needs_grant`.
 *
 * Returns a `needs_status` denial for unauthenticated callers, so the result is
 * always a well-formed decision; use {@link requireCapability} when you want the
 * 401/403 distinction handled for you.
 */
export function check(
	capability: Capability,
	locals: Locals,
	overrides?: Partial<MemberContext>
): CapabilityResult {
	return can(capability, getMemberContext(locals, overrides));
}

/** Boolean convenience for branches that genuinely don't need the reason. */
export function hasCapability(
	capability: Capability,
	locals: Locals,
	overrides?: Partial<MemberContext>
): boolean {
	return !!locals.user && check(capability, locals, overrides).allowed;
}

/**
 * Require a capability, or throw.
 *
 * - No session → **401**, matching the existing `requireAdmin` behaviour.
 * - Denied → **403** carrying the policy's member-facing message, so an API
 *   client and the UI say the same thing about the same refusal.
 */
export function requireCapability(
	capability: Capability,
	locals: Locals,
	overrides?: Partial<MemberContext>
): void {
	if (!locals.user) error(401, 'Unauthorized');

	const result = check(capability, locals, overrides);
	if (!result.allowed) error(403, result.message);
}

/** The caller's role, or `trial` when they hold none of the role groups. */
export function currentRole(locals: Locals): Role {
	return resolveRole(parseGroups(locals));
}

/** The caller's membership status. See {@link getMemberContext} on the fallback. */
export function currentStatus(locals: Locals): MembershipStatus {
	return getMemberContext(locals).status;
}
