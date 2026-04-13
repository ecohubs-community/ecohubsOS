import { env } from '$env/dynamic/private';
import { listmonkLogger } from '$lib/server/logger';

/**
 * Subscribe a new member to the Listmonk newsletter list.
 * Fire-and-forget — logs errors but does not throw.
 */
export async function subscribeToNewsletter(name: string, email: string): Promise<void> {
	const apiUrl = env.LISTMONK_API_URL;
	const apiUser = env.LISTMONK_API_USER;
	const apiKey = env.LISTMONK_API_KEY;
	const listId = parseInt(env.LISTMONK_MEMBER_LIST_ID || '3', 10);

	if (!apiUrl || !apiUser || !apiKey) {
		listmonkLogger.warn('Listmonk not configured (missing LISTMONK_API_URL, LISTMONK_API_USER, or LISTMONK_API_KEY) — skipping newsletter subscription');
		return;
	}

	const url = `${apiUrl}/subscribers`;
	const body = {
		email,
		name,
		status: 'enabled',
		lists: [listId],
		preconfirm_subscriptions: true
	};

	listmonkLogger.info({ email, listId }, 'Subscribing member to newsletter');

	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Basic ${btoa(`${apiUser}:${apiKey}`)}`
			},
			body: JSON.stringify(body)
		});
	} catch (fetchErr) {
		listmonkLogger.error({ err: fetchErr, email, url }, 'Network error connecting to Listmonk API');
		return;
	}

	if (response.status === 409) {
		listmonkLogger.info({ email }, 'Subscriber already exists in Listmonk — skipping');
		return;
	}

	if (!response.ok) {
		const errorText = await response.text().catch(() => 'Could not read response body');
		listmonkLogger.error(
			{ status: response.status, statusText: response.statusText, errorBody: errorText, email },
			'Listmonk API returned error'
		);
		return;
	}

	listmonkLogger.info({ email, listId }, 'Successfully subscribed member to newsletter');
}
