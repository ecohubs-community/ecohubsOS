import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Onboarding helper: pull profile-shaped fields from the user's most recent
 * membership application so the onboarding profile step can pre-fill them.
 *
 * Returns empty strings for any field we can't recover. Never throws on a
 * malformed formData JSON — best-effort.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const [app] = await db
		.select({
			fullName: applications.fullName,
			formData: applications.formData
		})
		.from(applications)
		.where(eq(applications.email, locals.user.email))
		.orderBy(desc(applications.submittedAt))
		.limit(1);

	if (!app) {
		return json({
			displayName: '',
			bio: '',
			location: '',
			contribution: '',
			languages: ''
		});
	}

	let formData: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(app.formData);
		if (parsed && typeof parsed === 'object') formData = parsed as Record<string, unknown>;
	} catch {
		// Ignore — malformed application data shouldn't block onboarding.
	}

	const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

	return json({
		displayName: str(app.fullName),
		// `motivation` is the closest free-text the application captures; use
		// it as a friendly default for the bio field.
		bio: str(formData.motivation),
		location: str(formData.location),
		contribution: str(formData.contribution),
		languages: str(formData.languages)
	});
};
