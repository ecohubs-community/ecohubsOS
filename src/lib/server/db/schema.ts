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
	fullName: text('full_name').notNull(),
	email: text('email').notNull(),
	location: text('location'),
	timeAvailability: text('time_availability'),
	languages: text('languages'),
	motivation: text('motivation').notNull(),
	contribution: text('contribution').notNull(),
	experienceAreas: text('experience_areas'),
	proudProject: text('proud_project'),
	resonanceCombined: text('resonance_combined'),
	natureCommunityMeaning: text('nature_community_meaning'),
	values: text('values'),
	status: text('status').notNull().default('pending'), // pending, proposal_created, approved, rejected
	submittedAt: text('submitted_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	snapshotProposalId: text('snapshot_proposal_id'),
	snapshotProposalLink: text('snapshot_proposal_link'),
	aiRecommendation: text('ai_recommendation')
});
