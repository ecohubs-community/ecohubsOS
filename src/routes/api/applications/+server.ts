import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals, proposalVotes } from '$lib/server/db/schema';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { materialiseAllStale } from '$lib/server/voting/materialise';
import { getMembershipVisibility } from '$lib/server/membership-visibility';
import { env } from '$env/dynamic/private';
import { isValidEmail, isValidLength, MAX_LENGTHS, sanitizeString } from '$lib/server/validation';
import { apiLogger } from '$lib/server/logger';
import { clientIp } from '$lib/server/client-ip';
import { sendDiscordMessage } from '$lib/server/discord';
import { newApplicationMessage } from '$lib/server/discord-templates';
import { createSystemProposal } from '$lib/server/voting/system-proposal';
import { formatApplicationBody } from '$lib/server/voting/format-application';

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

// GET - List all applications (authenticated users only).
// Enriches applications with voting data from their linked local proposal.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	try {
		await materialiseAllStale();

		// Non-admin members only see applications submitted after their own
		// (and never their own). Admins see everything.
		const vis = await getMembershipVisibility(locals);
		const visibilityFilter = vis.restricted
			? and(
					gt(applications.submittedAt, vis.cutoff as string),
					sql`lower(${applications.email}) <> ${vis.email}`
				)
			: undefined;

		const allApplications = await db
			.select()
			.from(applications)
			.where(visibilityFilter)
			.orderBy(desc(applications.submittedAt));

		const applicationIds = allApplications.map((a) => a.id);

		// Fetch all linked proposals + their tally counts in two batched queries.
		const linkedProposals = applicationIds.length
			? await db
					.select()
					.from(proposals)
					.where(inArray(proposals.linkedApplicationId, applicationIds))
			: [];

		const proposalIds = linkedProposals.map((p) => p.id);
		const tallyRows = proposalIds.length
			? await db
					.select({
						proposalId: proposalVotes.proposalId,
						choice: proposalVotes.choice,
						n: sql<number>`count(*)`
					})
					.from(proposalVotes)
					.where(inArray(proposalVotes.proposalId, proposalIds))
					.groupBy(proposalVotes.proposalId, proposalVotes.choice)
			: [];

		const tallyByProposal = new Map<string, Record<string, number>>();
		for (const r of tallyRows) {
			const m = tallyByProposal.get(r.proposalId) ?? {};
			m[r.choice] = Number(r.n);
			tallyByProposal.set(r.proposalId, m);
		}

		const proposalByApp = new Map<string, (typeof linkedProposals)[number]>();
		for (const p of linkedProposals) {
			if (p.linkedApplicationId) proposalByApp.set(p.linkedApplicationId, p);
		}

		const enrichedApplications = allApplications.map((app) => {
			const proposal = proposalByApp.get(app.id);

			let votingStatus: 'none' | 'active' | 'closed' = 'none';
			let votingResult: 'approved' | 'rejected' | 'needs_review' | null = null;
			let votingEnd: number | null = null;
			let votingScores: number[] | null = null;
			let proposalId: string | null = null;

			if (proposal) {
				proposalId = proposal.id;
				if (proposal.status === 'active' || proposal.status === 'deliberating') {
					votingStatus = 'active';
				} else if (
					proposal.status === 'closed' ||
					proposal.status === 'ratifying' ||
					proposal.status === 'ratified'
				) {
					votingStatus = 'closed';
				}
				votingEnd = Math.floor(proposal.voteClosesAt.getTime() / 1000);

				const result = proposal.result;
				if (result === 'approved' || result === 'rejected' || result === 'needs_review') {
					votingResult = result;
				}

				// Project tally into the legacy [approve, reject, needs_review] order
				// so existing UI consumers keep working.
				const tally = tallyByProposal.get(proposal.id) ?? {};
				let choices: string[] = [];
				try {
					const parsed = JSON.parse(proposal.choices);
					if (Array.isArray(parsed)) choices = parsed.map(String);
				} catch {
					/* ignore */
				}
				if (choices.length > 0) {
					votingScores = choices.map((c) => tally[c] ?? 0);
				}
			}

			return {
				...app,
				proposalId,
				votingStatus,
				votingResult,
				votingEnd,
				votingScores
			};
		});

		return json({ applications: enrichedApplications });
	} catch (err) {
		apiLogger.error({ err }, 'Error fetching applications');
		error(500, 'Failed to fetch applications');
	}
};

// POST - Submit new application (external, requires API key)
export const POST: RequestHandler = async (event) => {
	const { request } = event;
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
	if (!checkRateLimit(clientIp(event))) {
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

		// Auto-create the membership voting proposal. Idempotent on
		// linkedApplicationId so request retries never duplicate.
		try {
			await createSystemProposal({
				type: 'operational',
				choiceSetKey: 'membership',
				tags: ['membership', 'system'],
				title: `Membership Application: ${sanitizedName}`,
				body: formatApplicationBody(newApplication),
				linkedApplicationId: newApplication.id,
				// `newApplicationMessage` below covers the announcement.
				skipDiscord: true
			});
			// Mark application as having a proposal so the legacy `pending`
			// status doesn't keep prompting admins to create one manually.
			await db
				.update(applications)
				.set({ status: 'proposal_created' })
				.where(eq(applications.id, newApplication.id));
		} catch (err) {
			// Don't fail the application submission if proposal creation hiccups.
			apiLogger.error(
				{ err, applicationId: newApplication.id },
				'Failed to auto-create membership proposal'
			);
		}

		// Discord notification (fire-and-forget). The createSystemProposal
		// call above also fires its own "new proposal" Discord ping.
		sendDiscordMessage({ content: newApplicationMessage({ fullName: sanitizedName }) });

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
