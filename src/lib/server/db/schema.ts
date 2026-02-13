import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// BetterAuth user table with extended fields
export const user = sqliteTable('user', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	// BetterAuth standard fields
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),

	// Authentik-specific fields
	authentikId: text('authentik_id').unique(),
	groups: text('groups'), // JSON array of group names
	roles: text('roles'), // JSON array of role names

	// Wallet connection (post-auth onboarding)
	walletAddress: text('wallet_address').unique(),
	walletConnectedAt: integer('wallet_connected_at', { mode: 'timestamp' }),

	// Safe owner proposal tracking
	safeProposalTxHash: text('safe_proposal_tx_hash'),
	safeOwnerStatus: text('safe_owner_status'), // 'pending' | 'confirmed' | 'executed' | 'delegate_added' | null
	safeRole: text('safe_role').default('owner'), // 'owner' | 'proposer'
	safeRoleStatus: text('safe_role_status'),

	// Offcoin / Puckstack connection
	puckstackUserId: text('puckstack_user_id'),

	// Onboarding progress (JSON: Record<string, string> mapping substepId -> ISO timestamp)
	onboardingProgress: text('onboarding_progress')
});

// BetterAuth session table
export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent')
});

// BetterAuth account table (for OAuth providers)
export const account = sqliteTable('account', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
	scope: text('scope'),
	idToken: text('id_token'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// BetterAuth verification table
export const verification = sqliteTable('verification', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const applications = sqliteTable('applications', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	// Core identifying fields (kept for querying)
	fullName: text('full_name').notNull(),
	email: text('email').notNull(),
	// All form data stored as JSON (supports all 41+ fields)
	formData: text('form_data').notNull(),
	// Administrative fields
	status: text('status').notNull().default('pending'), // pending, proposal_created, approved, rejected
	submittedAt: text('submitted_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	snapshotProposalId: text('snapshot_proposal_id'),
	snapshotProposalLink: text('snapshot_proposal_link'),
	aiRecommendation: text('ai_recommendation'),
	confirmationEmailSentAt: text('confirmation_email_sent_at')
});
