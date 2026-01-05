import Safe from '@safe-global/protocol-kit';
import SafeApiKit from '@safe-global/api-kit';
import { env } from '$env/dynamic/private';

// Safe proposal status
export type SafeProposalStatus = 'not_proposed' | 'pending' | 'confirmed' | 'executed' | 'already_owner';

interface ProposalResult {
	success: boolean;
	safeTxHash?: string;
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
	return new SafeApiKit({
		chainId,
		apiKey: env.SAFE_API_KEY
	});
}

/**
 * Check if an address is already a Safe owner
 */
export async function isSafeOwner(walletAddress: string): Promise<boolean> {
	const apiKit = getApiKit();
	const safeInfo = await apiKit.getSafeInfo(env.SAFE_ADDRESS!);
	return safeInfo.owners.some((owner) => owner.toLowerCase() === walletAddress.toLowerCase());
}

/**
 * Propose adding a new owner to the Safe
 * Uses the dedicated proposer wallet to sign and submit the proposal
 */
export async function proposeAddOwner(walletAddress: string): Promise<ProposalResult> {
	const { SAFE_ADDRESS, SAFE_PROPOSER_PRIVATE_KEY, SAFE_CHAIN_ID } = env;

	if (!SAFE_ADDRESS || !SAFE_PROPOSER_PRIVATE_KEY) {
		return {
			success: false,
			error: 'Safe configuration is incomplete'
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

		const chainId = BigInt(SAFE_CHAIN_ID || '1');

		// Initialize Protocol Kit with the proposer's private key
		const protocolKit = await Safe.init({
			provider: `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY || 'demo'}`,
			signer: SAFE_PROPOSER_PRIVATE_KEY,
			safeAddress: SAFE_ADDRESS
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

		// Get proposer address
		const proposerAddress = await protocolKit.getAddress();

		// Submit the proposal to the Safe Transaction Service
		const apiKit = getApiKit();
		await apiKit.proposeTransaction({
			safeAddress: SAFE_ADDRESS,
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
