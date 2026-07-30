/**
 * Server-side membership enforcement.
 *
 * `$lib/policy` decides and describes; this module is the half that throws.
 * Endpoints should reach for `requireCapability()` rather than hand-rolling
 * group checks, so that what the server enforces and what the UI explains can
 * never drift apart.
 *
 * ⚠️ Phase 1 dependency: `membershipStatus` and `offcoinLevel` are not on the
 * `user` table yet. Until the migration lands, {@link getMemberContext} falls
 * back to `active` / level 0 — see the notes on that function for why this is
 * safe but temporarily imprecise.
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
 * The membership fields Phase 1 adds to the `user` table. Declared separately
 * and read defensively so this module compiles and behaves correctly both
 * before and after the migration, without a cast at every call site.
 */
interface PendingMembershipFields {
	membershipStatus?: MembershipStatus | null;
	offcoinLevel?: number | null;
}

/**
 * Build the policy context for the current request.
 *
 * Two fallbacks apply until the Phase 1 migration:
 *
 * - **status → `active`.** Every existing account is active today, and the
 *   migration grandfathers them as such, so this is the correct reading rather
 *   than a guess.
 * - **level → `0`.** Level never affects an allow/deny decision — authorization
 *   is decided by Authentik group membership — so a stale level can only make a
 *   *denial message* imprecise ("you're at Level 0"), never wrongly grant or
 *   refuse access. Pass `overrides.level` at call sites that already hold a real
 *   level, and the snapshot column will supply it everywhere once it exists.
 */
export function getMemberContext(
	locals: Locals,
	overrides: Partial<MemberContext> = {}
): MemberContext {
	const user = locals.user as (typeof locals.user & PendingMembershipFields) | null;

	return {
		groups: parseGroups(locals),
		status: user?.membershipStatus ?? 'active',
		level: user?.offcoinLevel ?? 0,
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
