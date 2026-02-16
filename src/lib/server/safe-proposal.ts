import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { env } from '$env/dynamic/private';
import {
	createWalletClient,
	getAddress,
	http,
	type Account,
	type Chain,
	type Hex,
	type Transport,
	type WalletClient
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Safe proposal status
export type SafeProposalStatus = 'not_proposed' | 'pending' | 'confirmed' | 'executed' | 'already_owner';

function requireEnv(name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`Safe configuration is incomplete: ${name} is missing`);
	}
	return value;
}

function getRpcUrl(chainId: bigint): string {
	if (env.SAFE_RPC_URL) return env.SAFE_RPC_URL;
	if (chainId === 1n) return `https://eth-mainnet.g.alchemy.com/v2/${requireEnv('ALCHEMY_API_KEY')}`;
	throw new Error(`Safe configuration is incomplete: SAFE_RPC_URL is missing for chainId ${chainId}`);
}

function normalizePrivateKey(privateKey: string): Hex {
	const withPrefix = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
	if (withPrefix.length !== 66) {
		throw new Error('Safe configuration is incomplete: delegate signer private key is not 32 bytes');
	}
	return withPrefix as Hex;
}

function checksumAddress(address: string, label: string): string {
	try {
		return getAddress(address as `0x${string}`);
	} catch {
		throw new Error(`Safe configuration is incomplete: ${label} is not a valid Ethereum address`);
	}
}

function getChain(chainId: bigint, rpcUrl: string): Chain {
	return {
		id: Number(chainId),
		name: `chain-${chainId.toString()}`,
		nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
		rpcUrls: { default: { http: [rpcUrl] } }
	};
}

export function getSafeAddress(): string {
	return checksumAddress(requireEnv('SAFE_ADDRESS'), 'SAFE_ADDRESS');
}

function isHttpError(err: unknown): err is { status: number; body: unknown } {
	return (
		typeof err === 'object' &&
		err !== null &&
		'status' in err &&
		typeof (err as { status?: unknown }).status === 'number' &&
		'body' in err
	);
}

function serializeHttpError(err: { status: number; body: unknown }): Record<string, unknown> {
	const body = err.body as unknown;
	if (typeof body === 'object' && body !== null) return { status: err.status, body };
	if (typeof body === 'string') return { status: err.status, body: { message: body } };
	return { status: err.status, body: { message: String(body) } };
}

interface ProposalResult {
	success: boolean;
	safeTxHash?: string;
	error?: string;
	details?: Record<string, unknown>;
}

interface DelegateResult {
	success: boolean;
	error?: string;
	details?: Record<string, unknown>;
}

interface StatusResult {
	status: SafeProposalStatus;
	safeTxHash?: string;
	confirmations?: number;
	threshold?: number;
}

/**
 * Initialize API Kit for Safe Transaction Service
 */
function getApiKit(): SafeApiKit {
	const chainId = BigInt(env.SAFE_CHAIN_ID || '1');
	const SAFE_API_KEY = requireEnv('SAFE_API_KEY_1') + (env.SAFE_API_KEY_2 || '');
	return new SafeApiKit({
		chainId,
		apiKey: SAFE_API_KEY
	});
}

function getDelegatorSigner(): WalletClient<Transport, Chain, Account> {
	const chainId = BigInt(env.SAFE_CHAIN_ID || '1');
	const privateKey = env.SAFE_DELEGATOR_PRIVATE_KEY || env.SAFE_PROPOSER_PRIVATE_KEY;
	if (!privateKey) {
		throw new Error(
			'Safe configuration is incomplete: SAFE_DELEGATOR_PRIVATE_KEY (or SAFE_PROPOSER_PRIVATE_KEY fallback) is missing'
		);
	}
	const rpcUrl = getRpcUrl(chainId);
	const account = privateKeyToAccount(normalizePrivateKey(privateKey));
	return createWalletClient({
		account,
		chain: getChain(chainId, rpcUrl),
		transport: http(rpcUrl)
	}) as WalletClient<Transport, Chain, Account>;
}

/**
 * Check if an address is already a Safe owner
 */
export async function isSafeOwner(walletAddress: string): Promise<boolean> {
	const apiKit = getApiKit();
	const safeInfo = await apiKit.getSafeInfo(getSafeAddress());
	const target = checksumAddress(walletAddress, 'wallet address').toLowerCase();
	return safeInfo.owners.some((owner) => owner.toLowerCase() === target);
}

export async function isSafeDelegate(walletAddress: string): Promise<boolean> {
	const apiKit = getApiKit();
	const delegates = await apiKit.getSafeDelegates({
		safeAddress: getSafeAddress(),
		delegateAddress: checksumAddress(walletAddress, 'wallet address'),
		limit: 1,
		offset: 0
	});
	return delegates.count > 0;
}

export async function addSafeDelegate(walletAddress: string, label = 'Ecohubs Proposer'): Promise<DelegateResult> {
	let safeAddress: string | null = null;
	let delegateAddress: string | null = null;
	let delegateSignerAddress: string | null = null;
	try {
		const alreadyDelegate = await isSafeDelegate(walletAddress);
		if (alreadyDelegate) {
			return { success: true };
		}

		const apiKit = getApiKit();
		const delegatorSigner = getDelegatorSigner();
		delegateSignerAddress = delegatorSigner.account.address;
		safeAddress = getSafeAddress();
		delegateAddress = checksumAddress(walletAddress, 'wallet address');

		await apiKit.addSafeDelegate({
			safeAddress,
			delegateAddress,
			delegatorAddress: checksumAddress(delegateSignerAddress, 'delegate signer address'),
			label,
			signer: delegatorSigner
		});

		return { success: true };
	} catch (err) {
		console.error('Error adding Safe delegate:', err);
		const details: Record<string, unknown> = {
			stage: 'addSafeDelegate',
			safeAddress: env.SAFE_ADDRESS ?? null,
			safeAddressChecksummed: safeAddress,
			chainId: env.SAFE_CHAIN_ID ?? null,
			walletAddress,
			delegateAddressChecksummed: delegateAddress,
			delegateSignerAddress: delegateSignerAddress ? checksumAddress(delegateSignerAddress, 'delegate signer address') : null
		};
		if (isHttpError(err)) {
			details.http = serializeHttpError(err);
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to add Safe delegate',
			details
		};
	}
}

/**
 * Propose adding a new owner to the Safe
 * Uses the dedicated proposer wallet to sign and submit the proposal
 */
export async function proposeAddOwner(walletAddress: string): Promise<ProposalResult> {
	const missingEnvVars: string[] = [];
	if (!env.SAFE_ADDRESS) missingEnvVars.push('SAFE_ADDRESS');
	if (!env.SAFE_PROPOSER_PRIVATE_KEY) missingEnvVars.push('SAFE_PROPOSER_PRIVATE_KEY');

	if (missingEnvVars.length > 0) {
		return {
			success: false,
			error: `Safe configuration is incomplete: ${missingEnvVars.join(', ')} ${
				missingEnvVars.length === 1 ? 'is' : 'are'
			} missing`
		};
	}

	try {
		// Check if already an owner
		const ownerAddress = checksumAddress(walletAddress, 'wallet address');
		const alreadyOwner = await isSafeOwner(ownerAddress);
		if (alreadyOwner) {
			return {
				success: false,
				error: 'Address is already a Safe owner'
			};
		}

		const chainId = BigInt(env.SAFE_CHAIN_ID || '1');
		const provider = getRpcUrl(chainId);

		// Initialize Protocol Kit with the proposer's private key
		const protocolKit = await Safe.init({
			provider,
			signer: env.SAFE_PROPOSER_PRIVATE_KEY,
			safeAddress: getSafeAddress()
		});

		// Create the addOwner transaction
		// Keep the current threshold (don't change it)
		const safeTransaction = await protocolKit.createAddOwnerTx({
			ownerAddress
		});

		// Get the transaction hash
		const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);

		// Sign the transaction with the proposer wallet
		const senderSignature = await protocolKit.signHash(safeTxHash);

		const proposerAddress = await protocolKit.getSafeProvider().getSignerAddress();
		if (!proposerAddress) {
			return {
				success: false,
				error: 'Safe configuration is incomplete: proposer signer address could not be derived'
			};
		}

		// Submit the proposal to the Safe Transaction Service
		const apiKit = getApiKit();
		const proposerIsOwner = await isSafeOwner(proposerAddress);
		if (!proposerIsOwner) {
			const delegates = await apiKit.getSafeDelegates({
				safeAddress: getSafeAddress(),
				delegateAddress: proposerAddress,
				limit: 1,
				offset: 0
			});
			if (delegates.count === 0) {
				return {
					success: false,
					error: `Safe proposer ${proposerAddress} is not an owner or registered delegate for ${env.SAFE_ADDRESS}`
				};
			}
		}
		await apiKit.proposeTransaction({
			safeAddress: getSafeAddress(),
			safeTransactionData: safeTransaction.data,
			safeTxHash,
			senderAddress: proposerAddress,
			senderSignature: senderSignature.data
		});

		return {
			success: true,
			safeTxHash
		};
	} catch (err) {
		console.error('Error proposing addOwner transaction:', err);
		const details: Record<string, unknown> = {
			stage: 'proposeAddOwner',
			safeAddress: env.SAFE_ADDRESS ?? null,
			chainId: env.SAFE_CHAIN_ID ?? null,
			walletAddress
		};
		if (isHttpError(err)) {
			details.http = serializeHttpError(err);
		}
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to propose transaction',
			details
		};
	}
}

/**
 * Check the status of a Safe transaction proposal
 */
export async function checkProposalStatus(safeTxHash: string): Promise<StatusResult> {
	try {
		const apiKit = getApiKit();
		const tx = await apiKit.getTransaction(safeTxHash);

		if (tx.isExecuted) {
			return {
				status: 'executed',
				safeTxHash,
				confirmations: tx.confirmations?.length || 0,
				threshold: tx.confirmationsRequired
			};
		}

		const confirmations = tx.confirmations?.length || 0;
		const threshold = tx.confirmationsRequired;

		if (confirmations >= threshold) {
			return {
				status: 'confirmed',
				safeTxHash,
				confirmations,
				threshold
			};
		}

		return {
			status: 'pending',
			safeTxHash,
			confirmations,
			threshold
		};
	} catch (err) {
		console.error('Error checking proposal status:', err);
		return {
			status: 'not_proposed'
		};
	}
}

/**
 * Check if a wallet has a pending or executed proposal
 */
export async function getWalletProposalStatus(walletAddress: string): Promise<StatusResult> {
	// First check if already an owner
	const alreadyOwner = await isSafeOwner(walletAddress);
	if (alreadyOwner) {
		return {
			status: 'already_owner'
		};
	}

	// Check for pending transactions that would add this owner
	try {
		const apiKit = getApiKit();
		const pendingTxs = await apiKit.getPendingTransactions(env.SAFE_ADDRESS!);

		// Look for addOwner transactions for this wallet
		for (const tx of pendingTxs.results) {
			// Check if this is an addOwner transaction for the given wallet
			// The data field contains the encoded function call
			if (tx.data && tx.data.toLowerCase().includes(walletAddress.toLowerCase().slice(2))) {
				return await checkProposalStatus(tx.safeTxHash);
			}
		}
	} catch (err) {
		console.error('Error checking pending transactions:', err);
	}

	return {
		status: 'not_proposed'
	};
}
