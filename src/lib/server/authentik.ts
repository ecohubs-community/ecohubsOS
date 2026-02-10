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

	// Authentik invitation API expects the flow as a full API URL reference
	const flowRef = `/api/v3/flows/instances/${ENROLLMENT_FLOW_UUID}/`;

	const body = {
		name: `Membership: ${applicantName} (${applicantEmail})`,
		expires: expires.toISOString(),
		single_use: true,
		flow: flowRef,
		fixed_data: {
			name: applicantName,
			email: applicantEmail
		}
	};

	authentikLogger.info(
		{ applicantEmail, apiUrl, flowRef },
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
