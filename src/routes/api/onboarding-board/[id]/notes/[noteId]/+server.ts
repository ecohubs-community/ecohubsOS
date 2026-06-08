import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import { memberOnboardingNotes } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { addEvent } from '$lib/server/member-onboarding/service';
import { sanitizeString, MAX_LENGTHS } from '$lib/server/validation';

// PATCH — edit a note. Body: { text }
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	requireStewardOrAdmin(locals);

	const note = await db.query.memberOnboardingNotes.findFirst({
		where: and(
			eq(memberOnboardingNotes.id, params.noteId),
			eq(memberOnboardingNotes.onboardingId, params.id)
		)
	});
	if (!note) error(404, 'Note not found');

	const { text } = await request.json();
	const clean = sanitizeString(String(text ?? ''), MAX_LENGTHS.text);
	if (!clean) error(400, 'Note text is required');

	const now = new Date();
	await db
		.update(memberOnboardingNotes)
		.set({ text: clean, updatedAt: now })
		.where(eq(memberOnboardingNotes.id, note.id));

	await addEvent(params.id, 'note_edited', 'Note edited', locals.user!.id);

	return json({ success: true, text: clean, updatedAt: now.toISOString() });
};

// DELETE — remove a note.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireStewardOrAdmin(locals);

	const note = await db.query.memberOnboardingNotes.findFirst({
		where: and(
			eq(memberOnboardingNotes.id, params.noteId),
			eq(memberOnboardingNotes.onboardingId, params.id)
		)
	});
	if (!note) error(404, 'Note not found');

	await db.delete(memberOnboardingNotes).where(eq(memberOnboardingNotes.id, note.id));
	await addEvent(params.id, 'note_deleted', 'Note deleted', locals.user!.id);

	return json({ success: true });
};
