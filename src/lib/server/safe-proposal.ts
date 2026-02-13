import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { env } from '$env/dynamic/private';
import { createWalletClient, http, type Account, type Chain, type Hex, type Transport, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Safe proposal status
export type SafeProposalStatus = 'not_proposed' | 'pending' | 'confirmed' | 'executed' | 'already_owner';

function requireEnv(name: string): string {
	const value = env[name];
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

function getChain(chainId: bigint, rpcUrl: string): Chain {
	return {
		id: Number(chainId),
		name: `chain-${chainId.toString()}`,
		nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
		rpcUrls: { default: { http: [rpcUrl] } }
	};
}

interface ProposalResult {
	success: boolean;
	safeTxHash?: string;
	error?: string;
}

interface DelegateResult {
	success: boolean;
	error?: string;
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
	const safeInfo = await apiKit.getSafeInfo(requireEnv('SAFE_ADDRESS'));
	return safeInfo.owners.some((owner) => owner.toLowerCase() === walletAddress.toLowerCase());
}

export async function isSafeDelegate(walletAddress: string): Promise<boolean> {
	const apiKit = getApiKit();
	const delegates = await apiKit.getSafeDelegates({
		safeAddress: requireEnv('SAFE_ADDRESS'),
		delegateAddress: walletAddress,
		limit: 1,
		offset: 0
	});
	return delegates.count > 0;
}

export async function addSafeDelegate(walletAddress: string, label = 'Ecohubs Proposer'): Promise<DelegateResult> {
	try {
		const alreadyDelegate = await isSafeDelegate(walletAddress);
		if (alreadyDelegate) {
			return { success: true };
		}

		const apiKit = getApiKit();
		const delegatorSigner = getDelegatorSigner();
		const delegatorAddress = delegatorSigner.account.address;

		await apiKit.addSafeDelegate({
			safeAddress: requireEnv('SAFE_ADDRESS'),
			delegateAddress: walletAddress,
			delegatorAddress,
			label,
			signer: delegatorSigner
		});

		return { success: true };
	} catch (err) {
		console.error('Error adding Safe delegate:', err);
		return { success: false, error: err instanceof Error ? err.message : 'Failed to add Safe delegate' };
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
		const alreadyOwner = await isSafeOwner(walletAddress);
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
			safeAddress: env.SAFE_ADDRESS
		});

		// Create the addOwner transaction
		// Keep the current threshold (don't change it)
		const safeTransaction = await protocolKit.createAddOwnerTx({
			ownerAddress: walletAddress
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
				safeAddress: env.SAFE_ADDRESS,
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
			safeAddress: env.SAFE_ADDRESS,
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
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Failed to propose transaction'
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
