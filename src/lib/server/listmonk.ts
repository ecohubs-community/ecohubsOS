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
		listmonkLogger.warn(
			'Listmonk not configured (missing LISTMONK_API_URL, LISTMONK_API_USER, or LISTMONK_API_KEY) — skipping newsletter subscription'
		);
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

/**
 * Unsubscribe a member from the newsletter list.
 *
 * Listmonk has no "unsubscribe by email" endpoint, so this resolves the
 * subscriber by email first, then blocklists them — which stops delivery
 * without deleting their record, so an unsubscribe is reversible if someone
 * rejoins.
 *
 * Fire-and-forget, matching {@link subscribeToNewsletter}: an exit must not
 * fail because the newsletter service is unreachable.
 */
export async function unsubscribeFromNewsletter(email: string): Promise<boolean> {
	const apiUrl = env.LISTMONK_API_URL;
	const apiUser = env.LISTMONK_API_USER;
	const apiKey = env.LISTMONK_API_KEY;

	if (!apiUrl || !apiUser || !apiKey) {
		listmonkLogger.warn('Listmonk not configured — skipping newsletter unsubscribe');
		return false;
	}

	const authHeader = `Basic ${btoa(`${apiUser}:${apiKey}`)}`;

	try {
		// Listmonk's subscriber query is a SQL fragment; the email is escaped by
		// doubling single quotes before interpolation.
		const safeEmail = email.replace(/'/g, "''");
		const query = encodeURIComponent(`subscribers.email = '${safeEmail}'`);
		const lookup = await fetch(`${apiUrl}/subscribers?query=${query}`, {
			headers: { Authorization: authHeader }
		});

		if (!lookup.ok) {
			listmonkLogger.error({ status: lookup.status }, 'Listmonk subscriber lookup failed');
			return false;
		}

		const payload = await lookup.json();
		const results = payload?.data?.results ?? [];
		if (results.length === 0) {
			listmonkLogger.info({ email }, 'No Listmonk subscriber to unsubscribe');
			return true; // Already absent is the desired end state.
		}

		const ids = results.map((r: { id: number }) => r.id);
		const response = await fetch(`${apiUrl}/subscribers/query/blocklist`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: authHeader },
			body: JSON.stringify({ ids })
		});

		if (!response.ok) {
			listmonkLogger.error({ status: response.status }, 'Listmonk blocklist failed');
			return false;
		}

		listmonkLogger.info({ email, ids }, 'Unsubscribed member from newsletter');
		return true;
	} catch (err) {
		listmonkLogger.error({ err, email }, 'Listmonk unsubscribe failed');
		return false;
	}
}
