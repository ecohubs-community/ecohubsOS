import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/membership';
import { openCase } from '$lib/server/membership-cases';

// POST /api/membership/cases — open a disciplinary case.
// Body: { userId, publicSummary, privateNotes? }
//
// Suspends the member immediately and puts removal to a community vote. The
// suspension is the steward's call; the removal is not.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireCapability('membership.exit', locals);

	let body: { userId?: string; publicSummary?: string; privateNotes?: string };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!body.userId || typeof body.publicSummary !== 'string') {
		error(400, 'userId and publicSummary are required');
	}

	// Opening a case against yourself is almost certainly a mistake, and being
	// both subject and steward of the same case is not a position to be in.
	if (body.userId === locals.user.id) {
		error(400, 'You cannot open a case about yourself');
	}

	const result = await openCase({
		userId: body.userId,
		publicSummary: body.publicSummary,
		privateNotes: body.privateNotes,
		openedBy: locals.user.id
	});

	if (!result.ok) error(400, result.error ?? 'Could not open case');

	return json({ success: true, caseId: result.caseId, proposalId: result.proposalId });
};
