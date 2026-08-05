import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { POLICY } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const exit = vi.hoisted(() => ({
	executeExit: vi.fn(async () => ({
		statusSet: true,
		authentikGroupsRemoved: true,
		authentikDeactivated: true,
		sessionsRevoked: 0,
		newsletterUnsubscribed: true,
		discordRoleRemoved: true,
		warnings: [] as string[]
	}))
}));
vi.mock('$lib/server/membership-exit', () => exit);

const { materialiseMembershipReviews, listPendingReviews, resolveReview } =
	await import('./membership-review-service');

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

beforeEach(async () => {
	vi.clearAllMocks();
	exit.executeExit.mockResolvedValue({
		statusSet: true,
		authentikGroupsRemoved: true,
		authentikDeactivated: true,
		sessionsRevoked: 0,
		newsletterUnsubscribed: true,
		discordRoleRemoved: true,
		warnings: []
	});
	await db.delete(schema.membershipReviews);
	await db.delete(schema.membershipEvents);
	await db.delete(schema.user);
});

describe('materialising reviews', () => {
	it('proposes nothing for a member who has never participated', async () => {
		// The guard the whole phase turns on: absence of a signal is not evidence
		// of absence, and every existing account starts null.
		await seedUser(db, { lastParticipationAt: null, membershipStatusSince: daysAgo(3000) });
		expect(await materialiseMembershipReviews()).toBe(0);
	});

	it('queues one when a member has been idle past the threshold', async () => {
		await seedUser(db, {
			lastParticipationAt: daysAgo(POLICY.timers.memberToExited + 1)
		});
		expect(await materialiseMembershipReviews()).toBe(1);

		const pending = await listPendingReviews();
		expect(pending[0]).toMatchObject({ kind: 'member_to_exited', toStatus: 'exited' });
	});

	it('is free to re-run — no duplicates for the same elapsed timer', async () => {
		await seedUser(db, { lastParticipationAt: daysAgo(POLICY.timers.memberToExited + 1) });
		expect(await materialiseMembershipReviews()).toBe(1);
		expect(await materialiseMembershipReviews()).toBe(0);
		expect(await listPendingReviews()).toHaveLength(1);
	});
});

describe('resolving a review', () => {
	async function queueOne() {
		const u = await seedUser(db, {
			lastParticipationAt: daysAgo(POLICY.timers.memberToExited + 1)
		});
		await materialiseMembershipReviews();
		const [review] = await listPendingReviews();
		return { user: u, review };
	}

	it('applying an exit runs the full offboarding, not just a status flag', async () => {
		const { user, review } = await queueOne();
		const steward = await seedUser(db);

		const result = await resolveReview(review.id, 'apply', steward.id);
		expect(result.ok).toBe(true);
		expect(exit.executeExit).toHaveBeenCalledWith(user.id, expect.any(String), steward.id);
	});

	it('surfaces what the offboarding could not complete', async () => {
		exit.executeExit.mockResolvedValue({
			statusSet: true,
			authentikGroupsRemoved: false,
			authentikDeactivated: false,
			sessionsRevoked: 0,
			newsletterUnsubscribed: false,
			discordRoleRemoved: false,
			warnings: ['Authentik access was not fully revoked']
		});

		const { review } = await queueOne();
		const steward = await seedUser(db);
		const result = await resolveReview(review.id, 'apply', steward.id);

		expect(result.warnings).toContain('Authentik access was not fully revoked');
	});

	it('applying a standby proposal changes status directly', async () => {
		// Only exits go through executeExit — a standby is reversible and local.
		const u = await seedUser(db, {
			groups: JSON.stringify([]),
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby + 1)
		});
		await materialiseMembershipReviews();
		const [review] = await listPendingReviews();
		const steward = await seedUser(db);

		await resolveReview(review.id, 'apply', steward.id);

		expect(exit.executeExit).not.toHaveBeenCalled();
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('standby');
	});

	it('dismissing changes nothing about the membership', async () => {
		const { user, review } = await queueOne();
		const steward = await seedUser(db);

		await resolveReview(review.id, 'dismiss', steward.id, 'they emailed me');

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, user.id));
		expect(after.membershipStatus).toBe('active');
		expect(exit.executeExit).not.toHaveBeenCalled();
	});

	it('dismissing is "not now" — the timer keeps running', async () => {
		// A fresh review appears on the next run if they stay inactive, which is
		// what makes dismissal safe to use liberally.
		const { review } = await queueOne();
		const steward = await seedUser(db);
		await resolveReview(review.id, 'dismiss', steward.id);

		expect(await listPendingReviews()).toHaveLength(0);
		expect(await materialiseMembershipReviews()).toBe(1);
	});

	it('cannot resolve the same review twice', async () => {
		const { review } = await queueOne();
		const steward = await seedUser(db);

		expect((await resolveReview(review.id, 'dismiss', steward.id)).ok).toBe(true);
		expect((await resolveReview(review.id, 'apply', steward.id)).ok).toBe(false);
	});

	it('records the deciding steward on the audit trail', async () => {
		const u = await seedUser(db, {
			groups: JSON.stringify([]),
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby + 1)
		});
		await materialiseMembershipReviews();
		const [review] = await listPendingReviews();
		const steward = await seedUser(db);

		await resolveReview(review.id, 'apply', steward.id, 'agreed at the call');

		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, u.id));
		expect(events[0]).toMatchObject({ actorUserId: steward.id, reason: 'agreed at the call' });
	});
});
