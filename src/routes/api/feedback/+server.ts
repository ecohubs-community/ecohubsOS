import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { feedback } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { isValidLength, MAX_LENGTHS, sanitizeString } from '$lib/server/validation';

const TITLE_MAX = MAX_LENGTHS.displayName; // 100
const MESSAGE_MAX = MAX_LENGTHS.bio; // 2000

// GET - the caller's own feedback (members only ever see their own)
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const rows = await db
		.select({
			id: feedback.id,
			title: feedback.title,
			message: feedback.message,
			createdAt: feedback.createdAt
		})
		.from(feedback)
		.where(eq(feedback.userId, locals.user.id))
		.orderBy(desc(feedback.createdAt));

	return json({ feedback: rows });
};

// POST - submit feedback
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		error(400, 'Invalid request body');
	}

	const titleCheck = isValidLength(body.title ?? '', 1, TITLE_MAX);
	if (!titleCheck.valid) {
		error(400, `Title: ${titleCheck.error}`);
	}

	const messageCheck = isValidLength(body.message ?? '', 1, MESSAGE_MAX);
	if (!messageCheck.valid) {
		error(400, `Feedback: ${messageCheck.error}`);
	}

	const [row] = await db
		.insert(feedback)
		.values({
			userId: locals.user.id,
			title: sanitizeString(body.title, TITLE_MAX),
			message: sanitizeString(body.message, MESSAGE_MAX)
		})
		.returning({
			id: feedback.id,
			title: feedback.title,
			message: feedback.message,
			createdAt: feedback.createdAt
		});

	return json({ success: true, feedback: row });
};
