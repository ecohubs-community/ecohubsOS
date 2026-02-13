export interface AuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	// Authentik-specific fields (parsed from JSON)
	groups: string[];
	roles: string[];
	// Wallet connection
	walletAddress: string | null;
	// Safe owner status
	safeOwnerStatus: 'pending' | 'confirmed' | 'executed' | 'delegate_added' | null;
	safeRole: 'owner' | 'proposer' | null;
	safeRoleStatus: string | null;
}

class AuthState {
	user = $state<AuthUser | null>(null);

	setUser(user: AuthUser | null) {
		this.user = user;
	}

	clearUser() {
		this.user = null;
	}

	// Derived properties
	isAuthenticated = $derived(this.user !== null);

	// SSO user properties
	userName = $derived(this.user?.name ?? null);
	userEmail = $derived(this.user?.email ?? null);
	userImage = $derived(this.user?.image ?? null);
	userGroups = $derived(this.user?.groups ?? []);
	userRoles = $derived(this.user?.roles ?? []);

	// Wallet properties (from post-login onboarding)
	walletAddress = $derived(this.user?.walletAddress ?? null);
	hasWallet = $derived(!!this.user?.walletAddress);
	shortWalletAddress = $derived(
		this.user?.walletAddress
			? `${this.user.walletAddress.slice(0, 6)}...${this.user.walletAddress.slice(-4)}`
			: null
	);

	// Safe owner status
	isSafeOwner = $derived(this.user?.safeOwnerStatus === 'executed');
	safeStatus = $derived(this.user?.safeOwnerStatus ?? null);

	// Legacy compatibility (for components that still use shortAddress)
	shortAddress = $derived(this.shortWalletAddress);
}

export const auth = new AuthState();
