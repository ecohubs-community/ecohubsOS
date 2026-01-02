import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	age: integer('age')
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
	aiRecommendation: text('ai_recommendation')
});
