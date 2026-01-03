import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FLARUM_API_URL, FLARUM_API_KEY } from '$env/static/private';

/**
 * Check if a user exists in Flarum by email or username
 *
 * For username: Try to fetch user by slug directly
 * For email: Use filter[q] search (may require admin token)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Verify user is authenticated
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { identifier } = await request.json();

	if (!identifier || typeof identifier !== 'string') {
		error(400, 'Email or username is required');
	}

	const trimmedIdentifier = identifier.trim();
	const isEmail = trimmedIdentifier.includes('@');

	try {
		let exists = false;
		let user = null;

		// For email, use filter[q] search
		const response = await fetch(
			`${FLARUM_API_URL}/api/users`,
			{
				method: 'GET',
				headers: {
					Authorization: `Token ${FLARUM_API_KEY}; userId=1`,
					'Content-Type': 'application/vnd.api+json'
				}
			}
		);

		if (response.ok) {
			const data = await response.json();
			// Check if any user has matching email
			if (data.data && data.data.length > 0) {
				let matchedUser;
				if (isEmail) {
					matchedUser = data.data.find(
						(u: { attributes: { email?: string } }) =>
							u.attributes.email?.toLowerCase() === trimmedIdentifier.toLowerCase()
					);
				} else {
					matchedUser = data.data.find(
						(u: { attributes: { username?: string } }) =>
							u.attributes.username?.toLowerCase() === trimmedIdentifier.toLowerCase()
					);
				}
				if (matchedUser) {
					exists = true;
					user = {
						username: matchedUser.attributes.username,
						email: matchedUser.attributes.email
					};
				}
			}
		} else if (response.status === 403) {
			console.log('Flarum API: No permission to search by email, assuming user does not exist');
			error(403, 'Failed to check forum account: No permission');
		} else {
			const errorText = await response.text();
			console.error('Flarum check error:', response.status, errorText);
			error(500, 'Failed to check forum account');
		}
		

		return json({
			exists,
			user
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err; // Re-throw SvelteKit errors
		}
		console.error('Flarum check error:', err);
		error(500, 'Failed to check forum account');
	}
};
