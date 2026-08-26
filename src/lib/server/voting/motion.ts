import { error } from '@sveltejs/kit';

/**
 * A motion is the operative text — one clause, usually — not a second copy of
 * the description, so it is capped well below `body`'s 10k.
 */
export const MOTION_MAX = 5_000;

/**
 * Validate and normalise the optional motion off a request body.
 *
 * Absent, null, empty and whitespace-only all collapse to `null`. That matters:
 * an author who expands the motion box, thinks better of it and collapses it
 * again submits `""`, and storing that would leave a row whose motion is
 * "present but blank" — enough for the detail view to render a Motion heading
 * over nothing. One representation of "no motion", and it is NULL.
 *
 * Content is otherwise preserved verbatim, leading indentation included: this
 * is the text being ratified, and Markdown gives indentation meaning.
 */
export function normaliseMotion(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') error(400, 'Motion must be a string');
	if (raw.length > MOTION_MAX) error(400, `Motion must be ≤ ${MOTION_MAX} characters`);
	return raw.trim().length > 0 ? raw : null;
}
