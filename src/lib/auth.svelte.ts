export interface AuthUser {
	address: string;
	isOwner: boolean;
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
	walletAddress = $derived(this.user?.address ?? null);
	shortAddress = $derived(
		this.user?.address
			? `${this.user.address.slice(0, 6)}...${this.user.address.slice(-4)}`
			: null
	);
}

export const auth = new AuthState();
