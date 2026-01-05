/**
 * Wallet state management for post-login wallet connection
 */

class WalletState {
	isConnecting = $state(false);
	isConnected = $state(false);
	error = $state<string | null>(null);
	address = $state<string | null>(null);
	hasMetaMask = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			this.checkMetaMask();
		}
	}

	checkMetaMask(): boolean {
		this.hasMetaMask = typeof window.ethereum !== 'undefined' && !!window.ethereum.isMetaMask;
		return this.hasMetaMask;
	}

	async connect(): Promise<string | null> {
		if (!this.hasMetaMask) {
			this.error = 'MetaMask is not installed';
			return null;
		}

		this.isConnecting = true;
		this.error = null;

		try {
			const accounts = (await window.ethereum!.request({
				method: 'eth_requestAccounts'
			})) as string[];

			if (!accounts || accounts.length === 0) {
				throw new Error('No accounts found');
			}

			this.address = accounts[0];
			return this.address;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Failed to connect wallet';
			return null;
		} finally {
			this.isConnecting = false;
		}
	}

	async saveToProfile(walletAddress: string): Promise<boolean> {
		try {
			const response = await fetch('/api/wallet/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ walletAddress })
			});

			if (!response.ok) {
				const data = await response.json();
				this.error = data.message || 'Failed to save wallet';
				return false;
			}

			this.isConnected = true;
			return true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Connection failed';
			return false;
		}
	}

	async checkExistingConnection(): Promise<string | null> {
		if (!this.hasMetaMask) return null;

		try {
			const accounts = (await window.ethereum!.request({
				method: 'eth_accounts'
			})) as string[];

			if (accounts && accounts.length > 0) {
				this.address = accounts[0];
				return this.address;
			}
		} catch {
			// Silently fail - user hasn't connected yet
		}

		return null;
	}

	reset() {
		this.isConnecting = false;
		this.isConnected = false;
		this.error = null;
		this.address = null;
	}

	get shortAddress(): string | null {
		if (!this.address) return null;
		return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
	}
}

export const wallet = new WalletState();
