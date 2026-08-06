import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboarding, memberOnboardingNotes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { addEvent, personDisplayName } from '$lib/server/member-onboarding/service';
import { sanitizeString, MAX_LENGTHS } from '$lib/server/validation';

// POST — add a note to an onboarding journey. Body: { text }
export const POST: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const { text } = await request.json();
	const clean = sanitizeString(String(text ?? ''), MAX_LENGTHS.text);
	if (!clean) error(400, 'Note text is required');

	const [note] = await db
		.insert(memberOnboardingNotes)
		.values({ onboardingId: row.id, text: clean, createdBy: locals.user!.id })
		.returning();

	await addEvent(row.id, 'note_added', 'Note added', locals.user!.id);

	return json({
		id: note.id,
		text: note.text,
		createdBy: personDisplayName(locals.user!),
		createdAt: note.createdAt?.toISOString() ?? null,
		updatedAt: note.updatedAt?.toISOString() ?? null
	});
};
