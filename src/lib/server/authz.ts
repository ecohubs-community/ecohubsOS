import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { ROLE_GROUPS, parseGroupsJson } from '$lib/policy';

// Re-exported from `$lib/policy` so the group names have exactly one definition.
// `$lib/server/membership.ts` is the richer gate (capabilities, status, member-
// facing reasons); these remain for the many call sites that only need a role.
export const ADMIN_GROUP = ROLE_GROUPS.admin;
export const STEWARD_GROUP = ROLE_GROUPS.steward;

/**
 * Parse the JSON-encoded group list off `locals.user`. Returns [] when there
 * is no user or the field is missing/malformed. Mirrors the inline pattern used
 * across the existing /api/admin/* endpoints.
 */
export function parseGroups(locals: RequestEvent['locals']): string[] {
	return parseGroupsJson(locals.user?.groups as unknown as string | null);
}

export function isAdmin(locals: RequestEvent['locals']): boolean {
	return parseGroups(locals).includes(ADMIN_GROUP);
}

export function isStewardOrAdmin(locals: RequestEvent['locals']): boolean {
	const groups = parseGroups(locals);
	return groups.includes(ADMIN_GROUP) || groups.includes(STEWARD_GROUP);
}

/**
 * Require an authenticated EcoHubs Admin. Throws 401/403 otherwise.
 */
export function requireAdmin(locals: RequestEvent['locals']): void {
	if (!locals.user) error(401, 'Unauthorized');
	if (!isAdmin(locals)) error(403, 'Forbidden: Admin access required');
}

/**
 * Require an authenticated EcoHubs Steward OR Admin. Throws 401/403 otherwise.
 */
export function requireStewardOrAdmin(locals: RequestEvent['locals']): void {
	if (!locals.user) error(401, 'Unauthorized');
	if (!isStewardOrAdmin(locals)) error(403, 'Forbidden: Steward or Admin access required');
}
