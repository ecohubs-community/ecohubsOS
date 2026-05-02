import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
	// Active Puckstack invitation token while onboarding is in progress.
	// Persisted across sessions so the verify step still works when the
	// user closes the PuckstackSignup window between handleJoin and accept.
	// Cleared once `puckstackUserId` is set.
	puckstackInviteToken: text('puckstack_invite_token'),

	// Profile fields (user-editable)
	displayName: text('display_name'),
	avatar: text('avatar'),
	bio: text('bio'),
	languages: text('languages'),
	location: text('location'),
	contribution: text('contribution'),
	showOnWebsite: integer('show_on_website', { mode: 'boolean' }).default(true),

	// Onboarding progress (JSON: Record<string, string> mapping substepId -> ISO timestamp)
	onboardingProgress: text('onboarding_progress'),

	// Onboarding lifecycle timestamps
	onboardingStartedAt: integer('onboarding_started_at', { mode: 'timestamp' }),
	onboardingCompletedAt: integer('onboarding_completed_at', { mode: 'timestamp' })
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

export const proposals = sqliteTable('proposals', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	// 'operational' | 'strategic' | 'constitutional'
	type: text('type').notNull(),

	title: text('title').notNull(),
	body: text('body').notNull(),

	// nullable for system-generated proposals
	authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),

	// JSON array of tags (lower-kebab-case, max 5 — enforced in code)
	tags: text('tags').notNull().default('[]'),

	// Registry key in CHOICE_SETS — kept for traceability
	choiceSetKey: text('choice_set_key').notNull(),
	// JSON array snapshot of choices at creation time
	choices: text('choices').notNull(),

	// 'majority' | 'supermajority'
	threshold: text('threshold').notNull(),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	voteOpensAt: integer('vote_opens_at', { mode: 'timestamp' }).notNull(),
	voteClosesAt: integer('vote_closes_at', { mode: 'timestamp' }).notNull(),
	ratificationEndsAt: integer('ratification_ends_at', { mode: 'timestamp' }),

	// 'deliberating' | 'active' | 'closed' | 'ratifying' | 'ratified' | 'withdrawn'
	status: text('status').notNull().default('deliberating'),

	// 'approved' | 'rejected' | 'needs_review' | 'tied' | null (while open)
	result: text('result'),

	// JSON array of statuses already announced — idempotency for Discord
	discordNotifiedTransitions: text('discord_notified_transitions').notNull().default('[]'),

	// Unique link to triggering entity (one system proposal per application/draft)
	linkedApplicationId: text('linked_application_id').unique(),
	linkedBlogDraftId: text('linked_blog_draft_id').unique()
});

export const proposalVotes = sqliteTable('proposal_votes', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	proposalId: text('proposal_id')
		.notNull()
		.references(() => proposals.id, { onDelete: 'cascade' }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	choice: text('choice').notNull(),
	reason: text('reason'),
	votedAt: integer('voted_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
}, (table) => ({
	uniqueVotePerUser: uniqueIndex('proposal_votes_proposal_user_unique').on(
		table.proposalId,
		table.userId
	)
}));

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
	confirmationEmailSentAt: text('confirmation_email_sent_at'),
	rejectionEmailSentAt: text('rejection_email_sent_at')
});
