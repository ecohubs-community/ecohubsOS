import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { isValidEmail, isValidLength, MAX_LENGTHS, sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';
import { getProposalStatus, getMembershipVotingResult } from '$lib/server/blog-snapshot';

// Rate limiting for external submissions
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // 5 submissions per hour per IP

function checkRateLimit(identifier: string): boolean {
	const now = Date.now();
	const limit = rateLimitMap.get(identifier);

	if (!limit || now > limit.resetTime) {
		rateLimitMap.set(identifier, {
			count: 1,
			resetTime: now + RATE_LIMIT_WINDOW
		});
		return true;
	}

	if (limit.count >= RATE_LIMIT_MAX) {
		return false;
	}

	limit.count++;
	return true;
}

// GET - List all applications (authenticated users only)
// Enriches applications that have Snapshot proposals with live voting status
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	try {
		const allApplications = await db
			.select()
			.from(applications)
			.orderBy(desc(applications.submittedAt));

		// Enrich applications with Snapshot voting data
		const enrichedApplications = await Promise.all(
			allApplications.map(async (app) => {
				// Default enriched fields
				let votingStatus: 'none' | 'active' | 'closed' = 'none';
				let votingResult: 'approved' | 'rejected' | 'needs_review' | null = null;
				let votingEnd: number | null = null;
				let votingScores: number[] | null = null;

				if (app.snapshotProposalId && app.status !== 'pending') {
					try {
						const status = await getProposalStatus(app.snapshotProposalId);
						if (status) {
							votingStatus = status.status;
							votingEnd = status.end;
							votingScores = status.scores as unknown as number[];

							if (status.status === 'closed') {
								votingResult = getMembershipVotingResult(status);
							}
						}
					} catch (err) {
						apiLogger.error(
							{ err, applicationId: app.id },
							'Error fetching Snapshot voting status'
						);
					}
				}

				return {
					...app,
					votingStatus,
					votingResult,
					votingEnd,
					votingScores
				};
			})
		);

		return json({ applications: enrichedApplications });
	} catch (err) {
		apiLogger.error({ err }, 'Error fetching applications');
		error(500, 'Failed to fetch applications');
	}
};

// POST - Submit new application (external, requires API key)
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const apiKey = request.headers.get('x-api-key');
	const expectedApiKey = env.APPLICATIONS_API_KEY;

	// Validate API key for external submissions
	if (!expectedApiKey) {
		apiLogger.error('APPLICATIONS_API_KEY not configured');
		error(500, 'Server configuration error');
	}

	if (apiKey !== expectedApiKey) {
		error(401, 'Invalid API key');
	}

	// Rate limiting
	const clientIp = getClientAddress();
	if (!checkRateLimit(clientIp)) {
		return json(
			{ success: false, message: 'Too many submissions. Please try again later.' },
			{ status: 429 }
		);
	}

	try {
		const body = await request.json();

		// Validate required fields
		const { fullName, email } = body;

		// Validate full name
		const nameValidation = isValidLength(fullName, 1, MAX_LENGTHS.name);
		if (!nameValidation.valid) {
			error(400, `Full name: ${nameValidation.error}`);
		}

		// Validate email with proper RFC 5322 validation
		if (!isValidEmail(email)) {
			error(400, 'Please provide a valid email address');
		}

		// Sanitize inputs
		const sanitizedName = sanitizeString(fullName, MAX_LENGTHS.name);
		const sanitizedEmail = sanitizeString(email, MAX_LENGTHS.email).toLowerCase();

		// Insert application with all form data stored as JSON
		const [newApplication] = await db
			.insert(applications)
			.values({
				fullName: sanitizedName,
				email: sanitizedEmail,
				formData: JSON.stringify(body)
			})
			.returning();

		return json({
			success: true,
			applicationId: newApplication.id,
			message: 'Application submitted successfully'
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		apiLogger.error({ err }, 'Error creating application');
		error(500, 'Failed to submit application');
	}
};
