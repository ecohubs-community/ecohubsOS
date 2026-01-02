import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// GET - Get single application (authenticated users only)
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { id } = params;

	try {
		const [application] = await db.select().from(applications).where(eq(applications.id, id));

		if (!application) {
			error(404, 'Application not found');
		}

		return json({ application });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error fetching application:', err);
		error(500, 'Failed to fetch application');
	}
};

// PATCH - Update application (Safe owners only)
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	// Only Safe owners can update applications
	if (!locals.user.isOwner) {
		error(403, 'Only Safe owners can update applications');
	}

	const { id } = params;

	try {
		const body = await request.json();

		// Only allow updating specific fields
		const allowedFields = ['status', 'snapshotProposalId', 'snapshotProposalLink', 'aiRecommendation'];
		const updates: Record<string, string> = {};

		for (const field of allowedFields) {
			if (field in body && typeof body[field] === 'string') {
				updates[field] = body[field];
			}
		}

		if (Object.keys(updates).length === 0) {
			error(400, 'No valid fields to update');
		}

		// Validate status if provided
		if (updates.status) {
			const validStatuses = ['pending', 'proposal_created', 'approved', 'rejected'];
			if (!validStatuses.includes(updates.status)) {
				error(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
			}
		}

		const [updatedApplication] = await db
			.update(applications)
			.set(updates)
			.where(eq(applications.id, id))
			.returning();

		if (!updatedApplication) {
			error(404, 'Application not found');
		}

		return json({
			success: true,
			application: updatedApplication
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error updating application:', err);
		error(500, 'Failed to update application');
	}
};
