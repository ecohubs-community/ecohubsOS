import { OffcoinClient } from '@offcoin/sdk';
import { env } from '$env/dynamic/private';

let client: OffcoinClient | null = null;

export function getOffcoinClient(): OffcoinClient {
	if (!client) {
		const clientId = env.OFFCOIN_CLIENT_ID;
		const clientSecret = env.OFFCOIN_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error('OFFCOIN_CLIENT_ID and OFFCOIN_CLIENT_SECRET must be set');
		}

		client = new OffcoinClient({
			baseUrl: 'https://offcoin.space',
			clientId,
			clientSecret
		});
	}
	return client;
}
