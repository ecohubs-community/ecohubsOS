import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user, applications } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { sanitizeString, MAX_LENGTHS } from '$lib/server/validation';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const dbUser = await db.query.user.findFirst({
		where: eq(user.id, locals.user.id)
	});

	if (!dbUser) {
		error(404, 'User not found');
	}

	// If profile fields are null, try to get defaults from approved application
	let defaults: { languages?: string; location?: string; contribution?: string } = {};
	if (!dbUser.languages && !dbUser.location && !dbUser.contribution) {
		const application = await db.query.applications.findFirst({
			where: and(eq(applications.email, dbUser.email), eq(applications.status, 'approved'))
		});

		if (application?.formData) {
			try {
				const formData = JSON.parse(application.formData);
				defaults = {
					languages: formData.languages ?? undefined,
					location: formData.location ?? undefined,
					contribution: formData.contribution ?? undefined
				};
			} catch {
				// Ignore parse errors
			}
		}
	}

	return json({
		displayName: dbUser.displayName ?? '',
		avatar: dbUser.avatar ?? null,
		bio: dbUser.bio ?? '',
		languages: dbUser.languages ?? defaults.languages ?? '',
		location: dbUser.location ?? defaults.location ?? '',
		contribution: dbUser.contribution ?? defaults.contribution ?? ''
	});
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = await request.json();
	const updateFields: Record<string, string | null> = {};

	if ('displayName' in body) {
		const val = body.displayName?.trim() || null;
		if (val && val.length > MAX_LENGTHS.displayName) {
			error(400, `Display name must be less than ${MAX_LENGTHS.displayName} characters`);
		}
		updateFields.displayName = val ? sanitizeString(val, MAX_LENGTHS.displayName) : null;
	}

	if ('bio' in body) {
		const val = body.bio?.trim() || null;
		if (val && val.length > MAX_LENGTHS.bio) {
			error(400, `Bio must be less than ${MAX_LENGTHS.bio} characters`);
		}
		updateFields.bio = val ? sanitizeString(val, MAX_LENGTHS.bio) : null;
	}

	if ('languages' in body) {
		const val = body.languages?.trim() || null;
		if (val && val.length > MAX_LENGTHS.languages) {
			error(400, `Languages must be less than ${MAX_LENGTHS.languages} characters`);
		}
		updateFields.languages = val ? sanitizeString(val, MAX_LENGTHS.languages) : null;
	}

	if ('location' in body) {
		const val = body.location?.trim() || null;
		if (val && val.length > MAX_LENGTHS.location) {
			error(400, `Location must be less than ${MAX_LENGTHS.location} characters`);
		}
		updateFields.location = val ? sanitizeString(val, MAX_LENGTHS.location) : null;
	}

	if ('contribution' in body) {
		const val = body.contribution?.trim() || null;
		if (val && val.length > MAX_LENGTHS.contribution) {
			error(400, `Contribution must be less than ${MAX_LENGTHS.contribution} characters`);
		}
		updateFields.contribution = val ? sanitizeString(val, MAX_LENGTHS.contribution) : null;
	}

	if (Object.keys(updateFields).length === 0) {
		error(400, 'No valid fields to update');
	}

	try {
		await db
			.update(user)
			.set({ ...updateFields, updatedAt: new Date() })
			.where(eq(user.id, locals.user.id));

		return json({ success: true });
	} catch (err) {
		console.error('Error updating profile:', err);
		error(500, 'Failed to update profile');
	}
};
