import SafeApiKit from '@safe-global/api-kit';
import { env } from '$env/dynamic/private';

// Cache owners for performance (refresh every 5 minutes)
let cachedOwners: string[] | null = null;
let cacheTime: number | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a wallet address is an owner of the configured Safe
 * Uses Safe API Kit for verification
 */
export async function isSafeOwnerViaAPI(walletAddress: string): Promise<boolean> {
	const { SAFE_ADDRESS, SAFE_API_KEY_1, SAFE_API_KEY_2, SAFE_CHAIN_ID } = env;

	if (!SAFE_ADDRESS) {
		console.error('SAFE_ADDRESS environment variable is not set');
		return false;
	}
	const SAFE_API_KEY = (SAFE_API_KEY_1 ?? "") + SAFE_API_KEY_2;

	if (!SAFE_API_KEY) {
		console.error(
			'SAFE_API_KEY environment variable is not set. Get your API key at https://developer.safe.global'
		);
		return false;
	}

	try {
		const chainId = BigInt(SAFE_CHAIN_ID || '1');
		const apiKit = new SafeApiKit({
			chainId,
			apiKey: SAFE_API_KEY
		});

		const safeInfo = await apiKit.getSafeInfo(SAFE_ADDRESS);
		const owners = safeInfo.owners.map((addr) => addr.toLowerCase());

		return owners.includes(walletAddress.toLowerCase());
	} catch (error) {
		console.error('Error checking Safe ownership via API:', error);
		return false;
	}
}

/**
 * Get all Safe owners with caching
 * Returns cached list if available and fresh, otherwise fetches from API
 */
export async function getCachedSafeOwners(): Promise<string[]> {
	const { SAFE_ADDRESS, SAFE_API_KEY_1, SAFE_API_KEY_2, SAFE_CHAIN_ID } = env;

	if (!SAFE_ADDRESS) {
		console.error('SAFE_ADDRESS environment variable is not set');
		return [];
	}

	const SAFE_API_KEY = (SAFE_API_KEY_1 ?? "") + SAFE_API_KEY_2;

	if (!SAFE_API_KEY) {
		console.error(
			'SAFE_API_KEY environment variable is not set. Get your API key at https://developer.safe.global'
		);
		return [];
	}

	const now = Date.now();

	if (cachedOwners && cacheTime && now - cacheTime < CACHE_DURATION) {
		return cachedOwners;
	}

	try {
		const chainId = BigInt(SAFE_CHAIN_ID || '1');
		const apiKit = new SafeApiKit({
			chainId,
			apiKey: SAFE_API_KEY
		});

		const safeInfo = await apiKit.getSafeInfo(SAFE_ADDRESS);
		const owners = safeInfo.owners.map((addr) => addr.toLowerCase());

		cachedOwners = owners;
		cacheTime = now;

		return owners;
	} catch (error) {
		console.error('Error fetching Safe owners:', error);
		return cachedOwners || []; // Return stale cache on error
	}
}
