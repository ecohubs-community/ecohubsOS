/**
 * Offcoin integration state store
 *
 * Offcoin is the reputation/rewards system used by ecohubs.
 * Users connect by linking their wallet address to their Offcoin member account.
 *
 * Connection data is persisted both in localStorage (fast local cache) and
 * in the user DB record (puckstackUserId column) for cross-device persistence.
 * On new devices, initFromServer() bootstraps the connection from the DB.
 */

const STORAGE_KEY = 'offcoin-connection';

export interface OffcoinMember {
	id: string;
	name: string;
	xp: number;
	level: number;
	eco: number;
	role: string;
	aliases: string[];
	avatarUrl?: string;
}

interface StoredConnection {
	memberId: string;
	puckstackUserId: string;
	connectedAt: string;
}

function loadConnection(): StoredConnection | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function saveConnection(connection: StoredConnection | null): void {
	try {
		if (connection) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		// ignore
	}
}

class OffcoinState {
	// Connection state
	isConnected = $state(false);
	isLoading = $state(false);
	error = $state<string | null>(null);

	// Member data (only populated when connected)
	member = $state<OffcoinMember | null>(null);

	// Connection info
	puckstackUserId = $state<string | null>(null);

	// Track whether we've been initialized from server data
	private _initialized = false;

	// Derived values for easy access
	xp = $derived(this.member?.xp ?? 0);
	level = $derived(this.member?.level ?? 0);
	eco = $derived(this.member?.eco ?? 0);
	role = $derived(this.member?.role ?? 'Member');
	name = $derived(this.member?.name ?? 'Anonymous');
	avatarUrl = $derived(this.member?.avatarUrl ?? null);

	constructor() {
		// Load saved connection on init (client-side only)
		if (typeof window !== 'undefined') {
			const saved = loadConnection();
			if (saved) {
				this.puckstackUserId = saved.puckstackUserId;
				this.isConnected = true;
				// Refresh member data
				this.refreshMemberData();
			}
		}
	}

	/**
	 * Initialize from server-provided puckstackUserId.
	 * Called on page load with data from +page.server.ts.
	 *
	 * Handles two migration scenarios:
	 * 1. New device: server has puckstackUserId but localStorage doesn't → bootstrap from server
	 * 2. Existing user: localStorage has puckstackUserId but server doesn't → migrate to server
	 */
	initFromServer(serverPuckstackUserId: string | null | undefined): void {
		if (this._initialized) return;
		this._initialized = true;

		// Case 1: Already connected via localStorage
		if (this.isConnected && this.puckstackUserId) {
			// Migrate localStorage → server if server doesn't have it yet
			if (!serverPuckstackUserId) {
				this._migrateToServer(this.puckstackUserId);
			}
			return;
		}

		// Case 2: Server has puckstackUserId but localStorage doesn't → bootstrap from server
		if (serverPuckstackUserId) {
			this.puckstackUserId = serverPuckstackUserId;
			this.isConnected = true;

			// Save to localStorage so subsequent loads are instant
			saveConnection({
				memberId: '', // Will be populated after refresh
				puckstackUserId: serverPuckstackUserId,
				connectedAt: new Date().toISOString()
			});

			// Fetch member data (name, XP, ECO, etc.)
			this.refreshMemberData().then(() => {
				// Update localStorage with the actual memberId now that we have it
				if (this.member) {
					saveConnection({
						memberId: this.member.id,
						puckstackUserId: serverPuckstackUserId,
						connectedAt: new Date().toISOString()
					});
				}
			});
		}
	}

	/**
	 * Migrate puckstackUserId from localStorage to server DB (one-time, fire-and-forget).
	 * For existing users who connected Offcoin before server-side persistence was added.
	 */
	private _migrateToServer(puckstackUserId: string): void {
		fetch('/api/offcoin/migrate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ puckstackUserId })
		}).catch(() => {
			// Silently fail — will retry on next page load
		});
	}

	/**
	 * Connect wallet to Offcoin via Puckstack User ID
	 */
	async connect(puckstackUserId: string, walletAddress: string): Promise<boolean> {
		this.isLoading = true;
		this.error = null;

		try {
			const response = await fetch('/api/offcoin/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ puckstackUserId, walletAddress })
			});

			const data = await response.json();

			if (!response.ok) {
				this.error = data.message || 'Failed to connect to Offcoin';
				return false;
			}

			// Save connection
			this.member = data.member;
			this.puckstackUserId = puckstackUserId;
			this.isConnected = true;

			saveConnection({
				memberId: data.member.id,
				puckstackUserId,
				connectedAt: new Date().toISOString()
			});

			return true;
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Connection failed';
			return false;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Refresh member data from Offcoin
	 */
	async refreshMemberData(): Promise<void> {
		if (!this.puckstackUserId) return;

		this.isLoading = true;
		try {
			const response = await fetch(
				`/api/offcoin/member?puckstackUserId=${encodeURIComponent(this.puckstackUserId)}`
			);

			if (response.ok) {
				const data = await response.json();
				this.member = data.member;
			}
		} catch {
			// Silently fail refresh
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Disconnect from Offcoin
	 */
	disconnect(): void {
		this.isConnected = false;
		this.member = null;
		this.puckstackUserId = null;
		this.error = null;
		saveConnection(null);
	}
}

export const offcoin = new OffcoinState();
