import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { feedback, user } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

// GET - all feedback (admin only). Joined to the author for display name + date.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const userGroups: string[] = locals.user.groups
		? JSON.parse(locals.user.groups as unknown as string)
		: [];
	if (!userGroups.includes('EcoHubs Admin')) {
		error(403, 'Forbidden: Admin access required');
	}

	const rows = await db
		.select({
			id: feedback.id,
			title: feedback.title,
			message: feedback.message,
			createdAt: feedback.createdAt,
			acknowledgedAt: feedback.acknowledgedAt,
			authorName: user.displayName,
			authorFallbackName: user.name
		})
		.from(feedback)
		.leftJoin(user, eq(feedback.userId, user.id))
		.orderBy(desc(feedback.createdAt));

	const items = rows.map((r) => ({
		id: r.id,
		title: r.title,
		message: r.message,
		createdAt: r.createdAt,
		acknowledgedAt: r.acknowledgedAt,
		authorName: r.authorName || r.authorFallbackName || 'Unknown'
	}));

	return json({ feedback: items });
};
