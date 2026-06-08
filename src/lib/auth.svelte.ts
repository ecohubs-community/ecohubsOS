export interface AuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	// Authentik-specific fields (parsed from JSON)
	groups: string[];
	roles: string[];
	// Profile fields
	displayName: string | null;
	avatar: string | null;
	bio: string | null;
	languages: string | null;
	location: string | null;
	contribution: string | null;
	showOnWebsite: boolean;
	// Wallet connection
	walletAddress: string | null;
	// Safe owner status
	safeOwnerStatus: 'pending' | 'confirmed' | 'executed' | 'delegate_added' | null;
	safeRole: 'owner' | 'proposer' | null;
	safeRoleStatus: string | null;
	// Personal buddy-call scheduling URL (stewards/admins only)
	meetingSchedulingUrl?: string | null;
}

class AuthState {
	user = $state<AuthUser | null>(null);

	setUser(user: AuthUser | null) {
		console.log('Setting user:', user);
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

	// Profile properties
	userDisplayName = $derived(this.user?.displayName ?? this.user?.name ?? null);
	userAvatar = $derived(this.user?.avatar ?? this.user?.image ?? null);

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

	// EcoHubs Admin group membership — gates destructive admin actions like
	// cancelling applications + their linked proposals.
	isAdmin = $derived(this.user?.groups?.includes('EcoHubs Admin') ?? false);

	// EcoHubs Steward group membership — gates the Member Onboarding app and
	// steward-only profile fields (admins implicitly qualify too).
	isSteward = $derived(this.user?.groups?.includes('EcoHubs Steward') ?? false);
	isStewardOrAdmin = $derived(this.isAdmin || this.isSteward);

	// Personal buddy-call scheduling URL
	meetingSchedulingUrl = $derived(this.user?.meetingSchedulingUrl ?? null);

	// Legacy compatibility (for components that still use shortAddress)
	shortAddress = $derived(this.shortWalletAddress);
}

export const auth = new AuthState();
