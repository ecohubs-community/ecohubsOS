import { env } from '$env/dynamic/private';
import { authentikLogger } from '$lib/server/logger';

export interface AuthentikInvitation {
	pk: string;
	name: string;
	expires: string;
	single_use: boolean;
	flow: string;
}

/**
 * Derive the Authentik API base URL from the OIDC issuer URL.
 * AUTHENTIK_ISSUER_URL is like: https://authentik.example.com/application/o/ecohubsos
 * We need the base: https://authentik.example.com
 */
function getAuthentikBaseUrl(): string {
	const issuerUrl = env.AUTHENTIK_ISSUER_URL;
	if (!issuerUrl) {
		throw new Error('AUTHENTIK_ISSUER_URL is not configured');
	}
	const url = new URL(issuerUrl);
	return url.origin;
}

// Flow UUID for ecohubs-source-enrollment
const ENROLLMENT_FLOW_UUID = 'fb0c7097-da67-4e22-9434-8ce74b2c7a01';
const ENROLLMENT_FLOW_SLUG = 'ecohubs-source-enrollment';

/**
 * Create a one-time enrollment invitation in Authentik.
 * Uses the ecohubs-source-enrollment flow (UUID: fb0c7097-da67-4e22-9434-8ce74b2c7a01).
 */
export async function createAuthentikInvitation(
	applicantName: string,
	applicantEmail: string
): Promise<{ invitation: AuthentikInvitation; enrollmentUrl: string }> {
	const apiToken = env.AUTHENTIK_INVITATION_BOT_API_TOKEN;
	if (!apiToken) {
		throw new Error('AUTHENTIK_INVITATION_BOT_API_TOKEN is not configured');
	}

	const baseUrl = getAuthentikBaseUrl();
	const apiUrl = `${baseUrl}/api/v3/stages/invitation/invitations/`;

	// Invitation expires in 30 days
	const expires = new Date();
	expires.setDate(expires.getDate() + 30);

	// Authentik `name` field must be a valid slug (letters, numbers, underscores, hyphens) max 50 chars
	const slug = applicantName
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 40);
	const invitationName = `membership-${slug}`;

	// Authentik `flow` field expects a bare UUID
	const body = {
		name: invitationName,
		expires: expires.toISOString(),
		single_use: true,
		flow: ENROLLMENT_FLOW_UUID,
		fixed_data: {
			name: applicantName,
			email: applicantEmail
		}
	};

	authentikLogger.info(
		{ applicantEmail, apiUrl, flowUuid: ENROLLMENT_FLOW_UUID, invitationName },
		'Creating Authentik enrollment invitation'
	);
	authentikLogger.debug(
		{ requestBody: { ...body, fixed_data: { name: applicantName, email: '***' } } },
		'Authentik invitation request body'
	);

	let response: Response;
	try {
		response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiToken}`
			},
			body: JSON.stringify(body)
		});
	} catch (fetchErr) {
		authentikLogger.error(
			{ err: fetchErr, apiUrl },
			'Network error connecting to Authentik API'
		);
		throw new Error(`Failed to connect to Authentik API at ${apiUrl}: ${fetchErr}`);
	}

	if (!response.ok) {
		// Try to parse response as JSON, fall back to text for HTML error pages
		let errorDetail: string;
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			const errorData = await response.json().catch(() => null);
			errorDetail =
				errorData?.detail ||
				errorData?.non_field_errors?.join(', ') ||
				JSON.stringify(errorData);
			authentikLogger.error(
				{
					status: response.status,
					statusText: response.statusText,
					errorData,
					apiUrl
				},
				'Authentik API returned error (JSON)'
			);
		} else {
			const errorText = await response.text().catch(() => 'Could not read response body');
			// Truncate HTML responses for logging
			errorDetail =
				errorText.length > 500 ? errorText.slice(0, 500) + '...' : errorText;
			authentikLogger.error(
				{
					status: response.status,
					statusText: response.statusText,
					contentType,
					errorBody: errorDetail,
					apiUrl
				},
				'Authentik API returned error (non-JSON)'
			);
		}
		throw new Error(
			`Authentik API error (${response.status} ${response.statusText}): ${errorDetail}`
		);
	}

	const invitation = (await response.json()) as AuthentikInvitation & {
		pk: string;
	};

	// Build the enrollment URL using the flow slug and invitation token
	const enrollmentUrl = `${baseUrl}/if/flow/${ENROLLMENT_FLOW_SLUG}/?itoken=${invitation.pk}`;

	authentikLogger.info(
		{ applicantEmail, invitationPk: invitation.pk, enrollmentUrl },
		'Authentik enrollment invitation created successfully'
	);

	return { invitation, enrollmentUrl };
}

// ---------------------------------------------------------------------------
// Admin API helpers (groups + users) — used for in-app group assignment.
// Requires AUTHENTIK_INVITATION_BOT_API_TOKEN to have group/user read +
// group-membership write scope.
// ---------------------------------------------------------------------------

function getApiToken(): string {
	const apiToken = env.AUTHENTIK_INVITATION_BOT_API_TOKEN;
	if (!apiToken) {
		throw new Error('AUTHENTIK_INVITATION_BOT_API_TOKEN is not configured');
	}
	return apiToken;
}

/**
 * Thin wrapper around the Authentik admin REST API. Throws on non-2xx with a
 * useful message (JSON detail or truncated body), mirroring the invitation flow.
 */
async function authentikFetch(
	path: string,
	init?: { method?: string; body?: unknown }
): Promise<unknown> {
	const baseUrl = getAuthentikBaseUrl();
	const apiUrl = `${baseUrl}${path}`;
	const apiToken = getApiToken();

	let response: Response;
	try {
		response = await fetch(apiUrl, {
			method: init?.method ?? 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiToken}`
			},
			body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
		});
	} catch (fetchErr) {
		authentikLogger.error({ err: fetchErr, apiUrl }, 'Network error connecting to Authentik API');
		throw new Error(`Failed to connect to Authentik API at ${apiUrl}: ${fetchErr}`);
	}

	if (!response.ok) {
		let detail: string;
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			const errorData = await response.json().catch(() => null);
			detail =
				errorData?.detail || errorData?.non_field_errors?.join(', ') || JSON.stringify(errorData);
		} else {
			const text = await response.text().catch(() => 'Could not read response body');
			detail = text.length > 500 ? text.slice(0, 500) + '...' : text;
		}
		authentikLogger.error(
			{ status: response.status, statusText: response.statusText, apiUrl, detail },
			'Authentik admin API returned error'
		);
		throw new Error(`Authentik API error (${response.status} ${response.statusText}): ${detail}`);
	}

	// 204 No Content (add_user/remove_user) has no body.
	if (response.status === 204) return null;
	return response.json();
}

interface AuthentikListResponse<T> {
	results: T[];
}

/**
 * Look up an Authentik group's UUID (pk) by its exact name. Returns null if
 * no group matches.
 */
export async function getAuthentikGroupByName(name: string): Promise<string | null> {
	const data = (await authentikFetch(
		`/api/v3/core/groups/?name=${encodeURIComponent(name)}`
	)) as AuthentikListResponse<{ pk: string; name: string }>;
	const match = data.results?.find((g) => g.name === name);
	return match?.pk ?? null;
}

/**
 * Look up an Authentik user's numeric pk by email. We resolve by email rather
 * than relying on the stored `authentikId` because that holds the OIDC `sub`
 * claim, which is NOT the admin-API primary key. Returns null if not found.
 */
export async function getAuthentikUserByEmail(email: string): Promise<number | null> {
	const data = (await authentikFetch(
		`/api/v3/core/users/?email=${encodeURIComponent(email)}`
	)) as AuthentikListResponse<{ pk: number; email: string }>;
	const match = data.results?.find((u) => u.email.toLowerCase() === email.toLowerCase());
	return match?.pk ?? null;
}

/** Add a user (by numeric pk) to a group (by UUID). */
export async function addUserToAuthentikGroup(groupUuid: string, userPk: number): Promise<void> {
	await authentikFetch(`/api/v3/core/groups/${groupUuid}/add_user/`, {
		method: 'POST',
		body: { pk: userPk }
	});
	authentikLogger.info({ groupUuid, userPk }, 'Added user to Authentik group');
}

/** Remove a user (by numeric pk) from a group (by UUID). */
export async function removeUserFromAuthentikGroup(
	groupUuid: string,
	userPk: number
): Promise<void> {
	await authentikFetch(`/api/v3/core/groups/${groupUuid}/remove_user/`, {
		method: 'POST',
		body: { pk: userPk }
	});
	authentikLogger.info({ groupUuid, userPk }, 'Removed user from Authentik group');
}
