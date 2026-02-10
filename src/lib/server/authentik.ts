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
	const flowSlug = 'ecohubs-source-enrollment';

	// Invitation expires in 30 days
	const expires = new Date();
	expires.setDate(expires.getDate() + 30);

	const body = {
		name: `Membership: ${applicantName} (${applicantEmail})`,
		expires: expires.toISOString(),
		single_use: true,
		flow: flowSlug,
		fixed_data: {
			name: applicantName,
			email: applicantEmail
		}
	};

	authentikLogger.info({ applicantEmail }, 'Creating Authentik enrollment invitation');

	const response = await fetch(`${baseUrl}/api/v3/stages/invitation/invitations/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiToken}`
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
		authentikLogger.error(
			{ status: response.status, error: errorData },
			'Failed to create Authentik invitation'
		);
		throw new Error(
			`Authentik API error (${response.status}): ${errorData.detail || JSON.stringify(errorData)}`
		);
	}

	const invitation = (await response.json()) as AuthentikInvitation & {
		pk: string;
	};

	// Build the enrollment URL using the flow slug and invitation token
	const enrollmentUrl = `${baseUrl}/if/flow/${flowSlug}/?itoken=${invitation.pk}`;

	authentikLogger.info(
		{ applicantEmail, invitationPk: invitation.pk },
		'Authentik enrollment invitation created'
	);

	return { invitation, enrollmentUrl };
}
