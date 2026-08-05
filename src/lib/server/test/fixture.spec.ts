import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, fixtureTableDrift, FIXTURE_TABLES } from './fixture';

describe('the fixture', () => {
	it('creates exactly the tables it claims to', () => {
		// The DDL and FIXTURE_TABLES drifting apart is the failure that actually
		// happens, and it surfaces later as a confusing "no such table" inside an
		// unrelated test.
		expect(fixtureTableDrift()).toEqual({ missing: [], unlisted: [] });
	});

	it('covers the membership tables under test', () => {
		// A deliberate subset — onboarding, feedback and blog tables are
		// irrelevant here and carrying them would mean maintaining the schema
		// twice.
		for (const t of ['user', 'membership_cases', 'member_emails', 'reward_grants']) {
			expect(FIXTURE_TABLES).toContain(t);
		}
	});

	it('gives each test an isolated database', async () => {
		const a = createTestDb();
		const b = createTestDb();
		await seedUser(a.db, { email: 'only-in-a@example.com' });

		const inB = await b.db.query.user.findMany();
		expect(inB).toHaveLength(0);
	});

	it('enforces foreign keys, so cascades behave as they will in production', async () => {
		const { db, client } = createTestDb();
		expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
		const u = await seedUser(db);
		expect(u.id).toBeTruthy();
	});
});
