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

	// "Immediate Contributions" card completion (JSON: Record<string, string>
	// mapping contribution item id -> ISO timestamp). Separate from onboarding.
	contributionProgress: text('contribution_progress'),

	// Onboarding lifecycle timestamps
	onboardingStartedAt: integer('onboarding_started_at', { mode: 'timestamp' }),
	onboardingCompletedAt: integer('onboarding_completed_at', { mode: 'timestamp' }),

	// Welcome / intro video — set once the member watches ≥90% of the
	// onboarding presentation. Drives the auto-opening Welcome window and the
	// "watched" column in the Members app. Null = not yet watched.
	introWatchedAt: integer('intro_watched_at', { mode: 'timestamp' }),

	// Personal buddy-call scheduling URL (e.g. Cal.com / Calendly). Surfaced and
	// editable only for stewards/admins; used to pre-fill the buddy-call invite email.
	meetingSchedulingUrl: text('meeting_scheduling_url')
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
	status: text('status').notNull().default('pending'), // pending, proposal_created, approved, rejected, cancelled
	submittedAt: text('submitted_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	snapshotProposalId: text('snapshot_proposal_id'),
	snapshotProposalLink: text('snapshot_proposal_link'),
	aiRecommendation: text('ai_recommendation'),
	confirmationEmailSentAt: text('confirmation_email_sent_at'),
	rejectionEmailSentAt: text('rejection_email_sent_at'),
	// Admin cancellation (soft-delete) — visible in MembershipManager and surfaced on the
	// linked proposal's withdrawal callout for member transparency.
	cancelledAt: text('cancelled_at'),
	cancellationReason: text('cancellation_reason'),
	cancelledBy: text('cancelled_by')
});

// Member feedback / technical reports. Members submit and see only their own;
// admins review all and mark items acknowledged.
export const feedback = sqliteTable('feedback', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	message: text('message').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
	acknowledgedBy: text('acknowledged_by').references(() => user.id, { onDelete: 'set null' })
});

// Member onboarding journey tracking — steward/admin tooling powering the
// "Member Onboarding" kanban app. One row per accepted member, bridging an
// accepted application (pre-account) to a user (post-login) via email. The
// kanban stage is DERIVED (never stored) from these timestamps + the linked
// user, so the board can never drift out of sync with reality.
export const memberOnboarding = sqliteTable(
	'member_onboarding',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		// Source application (nullable; one onboarding row per application).
		applicationId: text('application_id').references(() => applications.id, {
			onDelete: 'set null'
		}),
		// Linked once an account with the same email appears (lazy, on board load).
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		// Stable join key between application and user.
		email: text('email').notNull(),
		// Denormalized — needed for display before a user row exists.
		fullName: text('full_name').notNull(),
		// Manual reminder email (sent to members who never logged in).
		reminderSentAt: integer('reminder_sent_at', { mode: 'timestamp' }),
		reminderSentBy: text('reminder_sent_by').references(() => user.id, { onDelete: 'set null' }),
		// Buddy-call invitation email.
		buddyCallInvitedAt: integer('buddy_call_invited_at', { mode: 'timestamp' }),
		buddyCallInvitedBy: text('buddy_call_invited_by').references(() => user.id, {
			onDelete: 'set null'
		}),
		// Buddy call that actually happened (date + with whom).
		buddyCallAt: integer('buddy_call_at', { mode: 'timestamp' }),
		buddyCallWith: text('buddy_call_with'),
		// Buddy call deliberately skipped ("not needed" — e.g. founder, or a member
		// already in regular contact). Counts as satisfying the buddy-call step.
		buddyCallSkippedAt: integer('buddy_call_skipped_at', { mode: 'timestamp' }),
		buddyCallSkippedBy: text('buddy_call_skipped_by').references(() => user.id, {
			onDelete: 'set null'
		}),
		// Set aside as unresponsive ("No response" lane). Non-destructive parking for
		// members who never engaged and likely never will. Reversible.
		dormantAt: integer('dormant_at', { mode: 'timestamp' }),
		dormantBy: text('dormant_by').references(() => user.id, { onDelete: 'set null' }),
		// On standby ("Standby" lane). Engaged member who asked to pause and will
		// return. `standbyUntil` is an optional follow-up date — once it passes the
		// card flags for attention so they aren't forgotten. Mutually exclusive with
		// dormant. Reversible.
		standbyAt: integer('standby_at', { mode: 'timestamp' }),
		standbyBy: text('standby_by').references(() => user.id, { onDelete: 'set null' }),
		standbyUntil: integer('standby_until', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => ({
		// Idempotency: at most one onboarding row per application (SQLite allows
		// multiple NULLs, so manually-created rows without an application are fine).
		uniqueApplication: uniqueIndex('member_onboarding_application_unique').on(table.applicationId)
	})
);

// Dated, attributed notes attached to an onboarding journey.
export const memberOnboardingNotes = sqliteTable('member_onboarding_notes', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	onboardingId: text('onboarding_id')
		.notNull()
		.references(() => memberOnboarding.id, { onDelete: 'cascade' }),
	text: text('text').notNull(),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

// Timeline of things that happened during an onboarding journey. Appended
// automatically by the relevant actions. `actorUserId` is null for system events.
export const memberOnboardingEvents = sqliteTable('member_onboarding_events', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	onboardingId: text('onboarding_id')
		.notNull()
		.references(() => memberOnboarding.id, { onDelete: 'cascade' }),
	// accepted | reminder_sent | logged_in | buddy_call_invited | buddy_call_held |
	// note_added | note_edited | note_deleted | completed
	type: text('type').notNull(),
	detail: text('detail'),
	actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});
