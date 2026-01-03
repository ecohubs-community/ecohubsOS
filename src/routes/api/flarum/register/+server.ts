import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FLARUM_API_URL, FLARUM_API_KEY } from '$env/static/private';

/**
 * Register a new user in Flarum and add them to the Member group
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// Verify user is authenticated
	if (!locals.user) {
		error(401, 'Not authenticated');
	}

	const { username, email, password } = await request.json();

	// Validate inputs
	if (!username || typeof username !== 'string') {
		error(400, 'Username is required');
	}
	if (!email || typeof email !== 'string') {
		error(400, 'Email is required');
	}
	if (!password || typeof password !== 'string') {
		error(400, 'Password is required');
	}
	if (password.length < 8) {
		error(400, 'Password must be at least 8 characters');
	}

	try {
		// Step 1: Create user in Flarum
		const createUserResponse = await fetch(`${FLARUM_API_URL}/api/users`, {
			method: 'POST',
			headers: {
				Authorization: `Token ${FLARUM_API_KEY}; userId=1`,
				'Content-Type': 'application/vnd.api+json'
			},
			body: JSON.stringify({
				data: {
					type: 'users',
					attributes: {
						username: username.trim(),
						email: email.trim(),
						password,
						isEmailConfirmed: true // Auto-confirm since they're already authenticated in ecohubsOS
					}
				}
			})
		});

		if (!createUserResponse.ok) {
			const errorData = await createUserResponse.json();
			console.error('Flarum create user error:', errorData);

			// Extract error message from Flarum's JSON:API error format
			const errorMsg =
				errorData.errors?.[0]?.detail ||
				errorData.errors?.[0]?.title ||
				'Failed to create forum account';
			error(400, errorMsg);
		}

		const userData = await createUserResponse.json();
		const userId = userData.data.id;

		// Step 2: Add user to "Member" group
		// Flarum default group IDs: 1=Admin, 2=Guest, 3=Member, 4=Mod
		// The "Member" group is typically ID 3, but this may vary by installation
		const memberGroupId = '3';

		const updateGroupResponse = await fetch(`${FLARUM_API_URL}/api/users/${userId}`, {
			method: 'PATCH',
			headers: {
				Authorization: `Token ${FLARUM_API_KEY}`,
				'Content-Type': 'application/vnd.api+json'
			},
			body: JSON.stringify({
				data: {
					type: 'users',
					id: userId,
					relationships: {
						groups: {
							data: [{ type: 'groups', id: memberGroupId }]
						}
					}
				}
			})
		});

		if (!updateGroupResponse.ok) {
			// Log but don't fail - user was created, group assignment is secondary
			console.error('Flarum group assignment warning:', await updateGroupResponse.text());
		}

		return json({
			success: true,
			message: 'Forum account created successfully',
			user: {
				id: userId,
				username: userData.data.attributes.username,
				email: userData.data.attributes.email
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err; // Re-throw SvelteKit errors
		}
		console.error('Flarum registration error:', err);
		error(500, 'Failed to create forum account');
	}
};
