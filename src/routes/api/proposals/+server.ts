import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

// POST - Update application with Snapshot proposal details
// Note: The actual Snapshot proposal creation happens client-side via ethers/Snapshot SDK
// This endpoint just updates the database with the proposal ID after creation
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	// Only Safe owners can create proposals
	if (locals.user.safeOwnerStatus !== 'executed') {
		error(403, 'Only Safe owners can create proposals');
	}

	try {
		const { applicationId, snapshotProposalId, snapshotProposalLink } = await request.json();

		if (!applicationId || typeof applicationId !== 'string') {
			error(400, 'Application ID is required');
		}

		if (!snapshotProposalId || typeof snapshotProposalId !== 'string') {
			error(400, 'Snapshot Proposal ID is required');
		}

		// Verify the application exists and is in pending status
		const [application] = await db
			.select()
			.from(applications)
			.where(eq(applications.id, applicationId));

		if (!application) {
			error(404, 'Application not found');
		}

		if (application.status !== 'pending') {
			error(400, 'Application already has a proposal or has been processed');
		}

		// Generate Snapshot link if not provided
		const snapshotSpace = env.SNAPSHOT_SPACE || 'ecohubs.eth';
		const proposalLink =
			snapshotProposalLink || `https://snapshot.org/#/${snapshotSpace}/proposal/${snapshotProposalId}`;

		// Update the application with proposal details
		const [updatedApplication] = await db
			.update(applications)
			.set({
				status: 'proposal_created',
				snapshotProposalId,
				snapshotProposalLink: proposalLink
			})
			.where(eq(applications.id, applicationId))
			.returning();

		return json({
			success: true,
			application: updatedApplication,
			proposalLink
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Error updating proposal:', err);
		error(500, 'Failed to update proposal');
	}
};

// GET - Get Snapshot configuration for client-side proposal creation
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const snapshotSpace = env.SNAPSHOT_SPACE || 'ecohubs.eth';
	const votingDuration = parseInt(env.SNAPSHOT_VOTING_DURATION || '604800', 10); // 7 days default

	return json({
		snapshotSpace,
		votingDuration
	});
};
