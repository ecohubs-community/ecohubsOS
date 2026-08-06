import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser, withFailingInserts } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { POLICY } from '$lib/policy';

const { db, client } = createTestDb();

vi.mock('$lib/server/db', () => ({ db }));

// The proposal mock writes a real row, because the rollback path is the whole
// point of several of these tests — withdrawing a vote that was never inserted
// would prove nothing.
let proposalSeq = 0;
const systemProposal = vi.hoisted(() => ({ createSystemProposal: vi.fn() }));
vi.mock('$lib/server/voting/system-proposal', () => systemProposal);

const exit = vi.hoisted(() => ({ executeExit: vi.fn(async () => ({ statusSet: true })) }));
vi.mock('$lib/server/membership-exit', () => exit);

const queue = vi.hoisted(() => ({ queueMemberEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('$lib/server/member-email-queue', () => queue);

const { openCase, applyCaseOutcome, closeCase, OPEN_CASE_STATUSES } =
	await import('./membership-cases');

async function insertProposal() {
	proposalSeq++;
	const now = new Date();
	const [row] = await db
		.insert(schema.proposals)
		.values({
			id: `p${proposalSeq}`,
			type: 'operational',
			title: 'End membership?',
			body: 'body',
			choiceSetKey: 'membership',
			choices: '[]',
			threshold: 'majority',
			createdAt: now,
			voteOpensAt: now,
			voteClosesAt: now,
			status: 'active'
		})
		.returning();
	return row;
}

const SUMMARY = 'Repeatedly ignored the community guidelines after two warnings';

beforeEach(() => {
	vi.clearAllMocks();
	systemProposal.createSystemProposal.mockImplementation(insertProposal);
	exit.executeExit.mockResolvedValue({ statusSet: true });
	queue.queueMemberEmail.mockResolvedValue({ ok: true });
});

describe('opening a case', () => {
	it('suspends the member and puts removal to the community', async () => {
		const u = await seedUser(db);
		const steward = await seedUser(db);

		const result = await openCase({
			userId: u.id,
			publicSummary: SUMMARY,
			openedBy: steward.id
		});

		expect(result.ok).toBe(true);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('standby');

		const [row] = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.id, result.caseId!));
		expect(row.status).toBe('voting');
		expect(row.proposalId).toBe(result.proposalId);
		// The status they held is stored, because a dismissal has to put them back
		// where they were rather than default everyone to active.
		expect(row.previousStatus).toBe('active');
	});

	it('drafts the member notification instead of sending it', async () => {
		const u = await seedUser(db);
		await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });

		expect(queue.queueMemberEmail).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'case_opened', userId: u.id })
		);
	});

	it('keeps the private notes out of the ballot', async () => {
		const u = await seedUser(db);
		const result = await openCase({
			userId: u.id,
			publicSummary: SUMMARY,
			privateNotes: 'Reported by another member who asked not to be named',
			openedBy: u.id
		});

		const [proposal] = await db
			.select()
			.from(schema.proposals)
			.where(eq(schema.proposals.id, result.proposalId!));
		expect(proposal.body).not.toContain('asked not to be named');
	});

	it('refuses a summary too short for voters to judge', async () => {
		const u = await seedUser(db);
		const result = await openCase({ userId: u.id, publicSummary: 'bad', openedBy: u.id });

		expect(result.ok).toBe(false);
		expect(systemProposal.createSystemProposal).not.toHaveBeenCalled();
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
	});

	it('refuses a second case, so two votes cannot run on the same person', async () => {
		const u = await seedUser(db);
		await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });
		const second = await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });

		expect(second.ok).toBe(false);
		const rows = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.userId, u.id));
		expect(rows).toHaveLength(1);
	});

	it('refuses a member who has already left', async () => {
		const u = await seedUser(db, { membershipStatus: 'exited' });
		const result = await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });

		expect(result.ok).toBe(false);
		expect(systemProposal.createSystemProposal).not.toHaveBeenCalled();
	});
});

describe('a suspension always has a way out', () => {
	// Regression guards for the ordering bug: the case used to suspend first and
	// create the vote second, so a failure in between left the member suspended
	// with no proposal — and applyCaseOutcome keys on proposalId, meaning nothing
	// could ever release them.

	it('leaves the member alone when the vote cannot be created', async () => {
		const u = await seedUser(db);
		systemProposal.createSystemProposal.mockRejectedValue(new Error('voting is down'));

		const result = await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });

		expect(result.ok).toBe(false);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
		const rows = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.userId, u.id));
		expect(rows).toHaveLength(0);
	});

	it('withdraws the vote when the case cannot be recorded after it', async () => {
		const u = await seedUser(db);

		await withFailingInserts(client, 'membership_cases', async () => {
			const result = await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });
			expect(result.ok).toBe(false);
		});

		// The community is not left deciding a case that was never opened...
		const created = await systemProposal.createSystemProposal.mock.results.at(-1)!.value;
		const [proposal] = await db
			.select()
			.from(schema.proposals)
			.where(eq(schema.proposals.id, created.id));
		expect(proposal.status).toBe('withdrawn');
		// ...and the member is not suspended by a half-finished case.
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
	});

	it('never records a voting case without a proposal to resolve it', async () => {
		const a = await seedUser(db);
		const b = await seedUser(db);
		await openCase({ userId: a.id, publicSummary: SUMMARY, openedBy: b.id });
		systemProposal.createSystemProposal.mockRejectedValue(new Error('voting is down'));
		await openCase({ userId: b.id, publicSummary: SUMMARY, openedBy: a.id });

		const open = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.status, 'voting'));
		expect(open.length).toBeGreaterThan(0);
		for (const row of open) expect(row.proposalId).not.toBeNull();
	});
});

describe('applying the outcome of the vote', () => {
	async function openOne() {
		const u = await seedUser(db);
		const result = await openCase({ userId: u.id, publicSummary: SUMMARY, openedBy: u.id });
		return { u, ...result };
	}

	it('ends the membership when the community approves', async () => {
		const { u, proposalId, caseId } = await openOne();
		await applyCaseOutcome(proposalId!, 'approved');

		expect(exit.executeExit).toHaveBeenCalledWith(u.id, expect.stringContaining(SUMMARY), null);
		const [row] = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.id, caseId!));
		expect(row.status).toBe('exited');
	});

	it('restores the previous status when the community declines', async () => {
		const { u, proposalId, caseId } = await openOne();
		await applyCaseOutcome(proposalId!, 'rejected');

		expect(exit.executeExit).not.toHaveBeenCalled();
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
		expect(after.standbyReason).toBeNull();
		const [row] = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.id, caseId!));
		expect(row.status).toBe('dismissed');
	});

	it('treats a tie as a decline, not a removal', async () => {
		const { u, proposalId } = await openOne();
		await applyCaseOutcome(proposalId!, 'tied');

		expect(exit.executeExit).not.toHaveBeenCalled();
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
	});

	it('leaves an inconclusive vote suspended and in front of a steward', async () => {
		// Silence must not remove someone — nor silently reinstate them mid-case.
		const { u, proposalId, caseId } = await openOne();
		await applyCaseOutcome(proposalId!, 'needs_review');

		expect(exit.executeExit).not.toHaveBeenCalled();
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('standby');
		const [row] = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.id, caseId!));
		expect(row.status).toBe('needs_review');
		expect(OPEN_CASE_STATUSES).toContain(row.status as 'needs_review');
	});

	it('does nothing on a re-run, since it is called from every lazy read', async () => {
		const { proposalId, caseId } = await openOne();
		await applyCaseOutcome(proposalId!, 'approved');
		exit.executeExit.mockClear();

		await applyCaseOutcome(proposalId!, 'rejected');

		expect(exit.executeExit).not.toHaveBeenCalled();
		const [row] = await db
			.select()
			.from(schema.membershipCases)
			.where(eq(schema.membershipCases.id, caseId!));
		expect(row.status).toBe('exited');
	});

	it('ignores a proposal that has not resolved yet', async () => {
		const { proposalId } = await openOne();
		await applyCaseOutcome(proposalId!, null);

		expect(exit.executeExit).not.toHaveBeenCalled();
	});
});

describe('closing a case by hand', () => {
	it('lifts the suspension and withdraws the vote', async () => {
		const u = await seedUser(db);
		const steward = await seedUser(db);
		const { caseId, proposalId } = await openCase({
			userId: u.id,
			publicSummary: SUMMARY,
			openedBy: steward.id
		});

		const result = await closeCase(caseId!, steward.id, 'withdrawn');

		expect(result.ok).toBe(true);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('active');
		const [proposal] = await db
			.select()
			.from(schema.proposals)
			.where(eq(schema.proposals.id, proposalId!));
		expect(proposal.status).toBe('withdrawn');
	});

	it('refuses to close an already resolved case', async () => {
		const u = await seedUser(db);
		const { caseId, proposalId } = await openCase({
			userId: u.id,
			publicSummary: SUMMARY,
			openedBy: u.id
		});
		await applyCaseOutcome(proposalId!, 'approved');

		const result = await closeCase(caseId!, u.id, 'dismissed');
		expect(result.ok).toBe(false);
	});
});

describe('the ballot a case uses', () => {
	it('is the 3-day operational vote, not a slower type', () => {
		// A suspension is live while this runs, so the vote must not drag: the
		// member is locked out either way until it resolves.
		expect(POLICY.reactivation.proposalType).toBe('operational');
	});

	it('never reads an empty ballot as agreement to remove someone', () => {
		expect(POLICY.reactivation.zeroVotesResult).toBe('needs_review');
	});

	it('does not treat any terminal outcome as open', () => {
		for (const terminal of ['exited', 'dismissed', 'withdrawn']) {
			expect(OPEN_CASE_STATUSES).not.toContain(terminal);
		}
	});
});
