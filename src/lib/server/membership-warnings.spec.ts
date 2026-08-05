import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { POLICY } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const queue = vi.hoisted(() => ({
	queueMemberEmail: vi.fn(async () => ({ id: 'draft-1', sent: false }))
}));
vi.mock('$lib/server/member-email-queue', () => queue);

const { sendDueWarnings } = await import('./membership-warnings');

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const TRIAL = { groups: JSON.stringify([]) };

beforeEach(async () => {
	vi.clearAllMocks();
	queue.queueMemberEmail.mockResolvedValue({ id: 'draft-1', sent: false });
	await db.delete(schema.membershipWarnings);
	await db.delete(schema.user);
});

describe('when a warning is due', () => {
	it('drafts nothing for a member nowhere near a threshold', async () => {
		await seedUser(db, { ...TRIAL, lastParticipationAt: daysAgo(1) });
		expect(await sendDueWarnings()).toBe(0);
		expect(queue.queueMemberEmail).not.toHaveBeenCalled();
	});

	it('drafts nothing for a member with no participation recorded', async () => {
		await seedUser(db, { ...TRIAL, lastParticipationAt: null });
		expect(await sendDueWarnings()).toBe(0);
	});

	it('drafts when a mark is reached', async () => {
		await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 14)
		});
		expect(await sendDueWarnings()).toBe(1);
		expect(queue.queueMemberEmail).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'timer_warning' })
		);
	});

	it('drafts nothing once the threshold has passed — by then it is a review', async () => {
		await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby + 5)
		});
		expect(await sendDueWarnings()).toBe(0);
	});

	it('skips exited members', async () => {
		await seedUser(db, {
			...TRIAL,
			membershipStatus: 'exited',
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 14)
		});
		expect(await sendDueWarnings()).toBe(0);
	});
});

describe('one warning per cycle', () => {
	it('does not draft the same mark twice', async () => {
		await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 14)
		});
		expect(await sendDueWarnings()).toBe(1);
		expect(await sendDueWarnings()).toBe(0);
	});

	it('drafts only the most urgent when several marks are due at once', async () => {
		// Happens whenever the app was quiet across a mark. Two emails in the same
		// minute would be worse than one.
		await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 3)
		});
		expect(await sendDueWarnings()).toBe(1);
		expect(queue.queueMemberEmail).toHaveBeenCalledTimes(1);
	});

	it('records the superseded marks so they cannot fire later', async () => {
		const u = await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 3)
		});
		await sendDueWarnings();

		const rows = await db
			.select()
			.from(schema.membershipWarnings)
			.where(eq(schema.membershipWarnings.userId, u.id));

		expect(rows).toHaveLength(POLICY.timers.warnBeforeDays.length);
		// Exactly one produced a draft; the rest are recorded without claiming
		// anything reached the member.
		expect(rows.filter((r) => r.drafted)).toHaveLength(1);
		expect(rows.filter((r) => !r.drafted).length).toBeGreaterThan(0);
	});

	it('warns again on a later cycle, once the anchor has moved', async () => {
		// Participating moves the anchor, which starts a new countdown. A naive
		// unique on (user, mark) would silence every cycle after the first, so the
		// member would be warned once and never again for the rest of their
		// membership.
		const u = await seedUser(db, {
			...TRIAL,
			lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 14)
		});
		expect(await sendDueWarnings()).toBe(1);

		// They act, then drift back into the window — a different anchor, so the
		// 14-day mark is due afresh rather than being remembered from last time.
		await db
			.update(schema.user)
			.set({ lastParticipationAt: daysAgo(POLICY.timers.trialToStandby - 10) })
			.where(eq(schema.user.id, u.id));

		expect(await sendDueWarnings()).toBe(1);
	});
});
