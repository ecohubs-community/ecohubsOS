import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export const ADMIN_GROUP = 'EcoHubs Admin';
export const STEWARD_GROUP = 'EcoHubs Steward';

/**
 * Parse the JSON-encoded group list off `locals.user`. Returns [] when there
 * is no user or the field is missing/malformed. Mirrors the inline pattern used
 * across the existing /api/admin/* endpoints.
 */
export function parseGroups(locals: RequestEvent['locals']): string[] {
	if (!locals.user?.groups) return [];
	try {
		const parsed = JSON.parse(locals.user.groups as unknown as string);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
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
