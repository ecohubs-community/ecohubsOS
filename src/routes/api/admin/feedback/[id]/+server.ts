import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { feedback } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// PATCH - acknowledge a feedback item (admin only). Idempotent.
export const PATCH: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const userGroups: string[] = locals.user.groups
		? JSON.parse(locals.user.groups as unknown as string)
		: [];
	if (!userGroups.includes('EcoHubs Admin')) {
		error(403, 'Forbidden: Admin access required');
	}

	const existing = await db.query.feedback.findFirst({
		where: eq(feedback.id, params.id)
	});
	if (!existing) {
		error(404, 'Feedback not found');
	}

	if (!existing.acknowledgedAt) {
		await db
			.update(feedback)
			.set({ acknowledgedAt: new Date(), acknowledgedBy: locals.user.id })
			.where(eq(feedback.id, params.id));
	}

	const [row] = await db
		.select({
			id: feedback.id,
			acknowledgedAt: feedback.acknowledgedAt
		})
		.from(feedback)
		.where(eq(feedback.id, params.id));

	return json({ success: true, feedback: row });
};
