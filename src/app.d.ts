// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

// BetterAuth user type (extended with custom fields)
interface AuthUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: Date;
	updatedAt: Date;
	// Authentik-specific fields
	authentikId: string | null;
	groups: string | null; // JSON string array
	roles: string | null; // JSON string array
	// Wallet connection
	walletAddress: string | null;
	walletConnectedAt: Date | null;
	// Safe owner proposal
	safeProposalTxHash: string | null;
	safeOwnerStatus: 'pending' | 'confirmed' | 'executed' | 'delegate_added' | null;
	safeRole: 'owner' | 'proposer' | null;
	safeRoleStatus: string | null;
	// Offcoin / Puckstack connection
	puckstackUserId: string | null;
	// Profile fields (user-editable)
	displayName: string | null;
	avatar: string | null;
	bio: string | null;
	languages: string | null;
	location: string | null;
	contribution: string | null;
	// Onboarding progress (JSON string: Record<string, string>)
	onboardingProgress: string | null;
	// Onboarding lifecycle timestamps
	onboardingStartedAt: Date | null;
	onboardingCompletedAt: Date | null;
}

interface AuthSession {
	id: string;
	userId: string;
	token: string;
	expiresAt: Date;
	createdAt: Date;
	updatedAt: Date;
	ipAddress: string | null;
	userAgent: string | null;
}

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthUser | null;
			session: AuthSession | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		ethereum?: {
			request(args: { method: string; params?: unknown[] }): Promise<unknown>;
			isMetaMask?: boolean;
		};
	}
}

export {};
