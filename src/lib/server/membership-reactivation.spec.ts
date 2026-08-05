import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import * as schema from './db/schema';
import { POLICY } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

let proposalSeq = 0;
const sys = vi.hoisted(() => ({ createSystemProposal: vi.fn() }));
vi.mock('$lib/server/voting/system-proposal', () => sys);

const { requestReactivation, getReactivationStatus } = await import('./membership-reactivation');

const DAY = 86_400_000;

/** Insert a proposal row and return it, mimicking createSystemProposal. */
async function fakeProposal(linkedApplicationId: string, over: Record<string, unknown> = {}) {
	proposalSeq++;
	const now = new Date();
	const [row] = await db
		.insert(schema.proposals)
		.values({
			id: `p${proposalSeq}`,
			type: 'operational',
			title: 'Reactivate',
			body: 'body',
			choiceSetKey: 'membership',
			choices: JSON.stringify(['Approve', 'Reject', 'Needs Review']),
			threshold: 'majority',
			createdAt: now,
			voteOpensAt: now,
			voteClosesAt: new Date(now.getTime() + 3 * DAY),
			status: 'active',
			linkedApplicationId,
			...over
		})
		.returning();
	return row;
}

beforeEach(async () => {
	vi.clearAllMocks();
	await db.delete(schema.proposals);
	await db.delete(schema.applications);
	await db.delete(schema.user);
	sys.createSystemProposal.mockImplementation(
		async (input: { linkedApplicationId: string }) => await fakeProposal(input.linkedApplicationId)
	);
});

describe('who may request', () => {
	it('refuses an active member — there is nothing to reactivate', async () => {
		const u = await seedUser(db, { membershipStatus: 'active' });
		const result = await requestReactivation(u.id, 'I would like to come back please');
		expect(result.ok).toBe(false);
		expect(result.error).toContain('standby');
	});

	it('accepts a standby member', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		const result = await requestReactivation(u.id, 'I have more time now and would like to return');
		expect(result.ok).toBe(true);
	});

	it('requires a real reason', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		expect((await requestReactivation(u.id, 'hi')).ok).toBe(false);
	});
});

describe('the request', () => {
	it('creates a reactivation application, not a membership one', async () => {
		// The type matters beyond bookkeeping: getMembershipVisibility anchors a
		// member's cutoff to their latest *membership* application, so a
		// misclassified row would retroactively hide their own history from them.
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to pick things back up');

		const apps = await db.select().from(schema.applications);
		expect(apps).toHaveLength(1);
		expect(apps[0].type).toBe('reactivation');
		expect(apps[0].email).toBe(u.email);
	});

	it('puts it to a vote the member cannot author themselves', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		const result = await requestReactivation(u.id, 'Ready to contribute again');

		expect(sys.createSystemProposal).toHaveBeenCalledTimes(1);
		expect(result.proposalId).toBeTruthy();
	});

	it('uses the 3-day operational vote', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'Ready to contribute again');

		expect(sys.createSystemProposal).toHaveBeenCalledWith(
			expect.objectContaining({ type: POLICY.reactivation.proposalType })
		);
	});

	it('refuses a second request while one is being voted on', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'First request with enough words');

		const second = await requestReactivation(u.id, 'Second request with enough words');
		expect(second.ok).toBe(false);
		expect(second.error).toContain('already');
	});
});

describe('status reporting', () => {
	it('reports nothing before any request', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		expect(await getReactivationStatus(u.id, u.email)).toMatchObject({ state: 'none' });
	});

	it('reports pending while the vote runs', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to come back now');

		expect(await getReactivationStatus(u.id, u.email)).toMatchObject({ state: 'pending' });
	});

	it('reports approved once the vote passes', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to come back now');
		await db.update(schema.proposals).set({ status: 'closed', result: 'approved' });

		expect(await getReactivationStatus(u.id, u.email)).toMatchObject({ state: 'approved' });
	});

	it('starts a cooldown after a rejection, so it cannot be resubmitted at once', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to come back now');
		await db.update(schema.proposals).set({ status: 'closed', result: 'rejected' });

		const status = await getReactivationStatus(u.id, u.email);
		expect(status.state).toBe('rejected');
		expect(status.cooldownUntil).toBeTruthy();

		const blocked = await requestReactivation(u.id, 'Asking again immediately after');
		expect(blocked.ok).toBe(false);
	});

	it('treats a tie as not approved — the status quo holds', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to come back now');
		await db.update(schema.proposals).set({ status: 'closed', result: 'tied' });

		expect(await getReactivationStatus(u.id, u.email)).toMatchObject({ state: 'rejected' });
	});

	it('routes an inconclusive vote to a steward rather than a refusal', async () => {
		const u = await seedUser(db, { membershipStatus: 'standby' });
		await requestReactivation(u.id, 'I would like to come back now');
		await db.update(schema.proposals).set({ status: 'closed', result: 'needs_review' });

		const status = await getReactivationStatus(u.id, u.email);
		expect(status.state).toBe('needs_review');
		// No cooldown — nobody decided anything against them.
		expect(status.cooldownUntil).toBeNull();
	});
});
