import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { listPendingEmails } from '$lib/server/member-email-queue';

// GET /api/member-emails — drafts awaiting a steward's decision.
//
// Every membership message the system writes lands here first. Nothing reaches
// a member's inbox without someone reading it and pressing send.
export const GET: RequestHandler = async ({ locals }) => {
	requireCapability('onboarding.manage', locals);
	const emails = await listPendingEmails();
	return json({ emails });
};
