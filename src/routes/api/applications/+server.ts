import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

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
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	try {
		const allApplications = await db
			.select()
			.from(applications)
			.orderBy(desc(applications.submittedAt));

		return json({ applications: allApplications });
	} catch (err) {
		console.error('Error fetching applications:', err);
		error(500, 'Failed to fetch applications');
	}
};

// POST - Submit new application (external, requires API key)
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const apiKey = request.headers.get('x-api-key');
	const expectedApiKey = env.APPLICATIONS_API_KEY;

	// Validate API key for external submissions
	if (!expectedApiKey) {
		console.error('APPLICATIONS_API_KEY not configured');
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

		if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
			error(400, 'Full name is required');
		}

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			error(400, 'Valid email is required');
		}

		// Insert application with all form data stored as JSON
		const [newApplication] = await db
			.insert(applications)
			.values({
				fullName: fullName.trim(),
				email: email.trim().toLowerCase(),
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
		console.error('Error creating application:', err);
		error(500, 'Failed to submit application');
	}
};
