import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { getEnrichedBoard, STAGES } from '$lib/server/member-onboarding/service';
import { apiLogger } from '$lib/server/logger';

// GET — the full onboarding kanban board (steward/admin only).
export const GET: RequestHandler = async ({ locals }) => {
	requireStewardOrAdmin(locals);
	try {
		const cards = await getEnrichedBoard();
		return json({ stages: STAGES, cards });
	} catch (err) {
		apiLogger.error({ err }, 'Failed to load onboarding board');
		return json({ stages: STAGES, cards: [] }, { status: 500 });
	}
};
