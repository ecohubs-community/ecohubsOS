import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ messageId: 'm1' })) }));
vi.mock('$lib/email', () => mail);
vi.mock('$lib/server/member-onboarding/emailTemplates', () => ({
	renderBrandedEmailHtml: (b: string) => `<html>${b}</html>`
}));

const {
	queueMemberEmail,
	listPendingEmails,
	countPendingEmails,
	sendQueuedEmail,
	dismissQueuedEmail
} = await import('./member-email-queue');

beforeEach(() => {
	vi.clearAllMocks();
	mail.sendEmail.mockResolvedValue({ messageId: 'm1' });
});

async function draft(userId: string, email: string, over: Record<string, unknown> = {}) {
	return queueMemberEmail({
		userId,
		email,
		kind: 'case_opened',
		subject: 'A pause while we talk',
		body: 'Hi there, a concern was raised.',
		...over
	});
}

describe('drafting', () => {
	it('does not send a queued kind', async () => {
		// The rule the whole queue exists for: nothing reaches a member without a
		// person choosing to send it.
		const u = await seedUser(db);
		const result = await draft(u.id, u.email, { relatedId: 'c1' });

		expect(result?.sent).toBe(false);
		expect(mail.sendEmail).not.toHaveBeenCalled();
		expect(await countPendingEmails()).toBe(1);
	});

	it('sends an autoSend kind immediately, and still records it', async () => {
		// application_approved is the one exception — the member is waiting on it
		// to get in at all. It is logged so the queue stays a complete record.
		const u = await seedUser(db);
		const result = await draft(u.id, u.email, {
			kind: 'application_approved',
			relatedId: 'a1'
		});

		expect(result?.sent).toBe(true);
		expect(mail.sendEmail).toHaveBeenCalledTimes(1);

		const rows = await db
			.select()
			.from(schema.memberEmails)
			.where(eq(schema.memberEmails.userId, u.id));
		expect(rows[0].status).toBe('sent');
	});

	it('falls back to the queue when an auto-send fails', async () => {
		// A failed automatic message becomes a human's problem rather than a lost
		// one — the safer direction.
		mail.sendEmail.mockRejectedValue(new Error('smtp down'));
		const u = await seedUser(db);
		const result = await draft(u.id, u.email, {
			kind: 'application_approved',
			relatedId: 'a2'
		});

		expect(result?.sent).toBe(false);
		expect(await countPendingEmails()).toBeGreaterThan(0);
	});

	it('dedupes on the same event, so lazy evaluators can call it freely', async () => {
		const u = await seedUser(db);
		const first = await draft(u.id, u.email, { relatedId: 'same' });
		const second = await draft(u.id, u.email, { relatedId: 'same' });

		expect(first).not.toBeNull();
		expect(second).toBeNull();
	});

	it('allows separate drafts for separate events', async () => {
		const u = await seedUser(db);
		expect(await draft(u.id, u.email, { relatedId: 'e1' })).not.toBeNull();
		expect(await draft(u.id, u.email, { relatedId: 'e2' })).not.toBeNull();
	});
});

describe('sending a draft', () => {
	it('sends what the steward actually wrote, not the template', async () => {
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 's1' });
		const [pending] = await listPendingEmails();

		const result = await sendQueuedEmail(pending.id, u.id, {
			subject: 'Reworded subject',
			body: 'Reworded body that a person wrote.'
		});

		expect(result.ok).toBe(true);
		expect(mail.sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({ subject: 'Reworded subject' })
		);
	});

	it('keeps the edit when delivery fails, so a retry does not lose it', async () => {
		mail.sendEmail.mockRejectedValue(new Error('smtp down'));
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 's2' });
		const [pending] = await listPendingEmails();

		const result = await sendQueuedEmail(pending.id, u.id, { body: 'Carefully written.' });
		expect(result.ok).toBe(false);

		const [row] = await db
			.select()
			.from(schema.memberEmails)
			.where(eq(schema.memberEmails.id, pending.id));
		expect(row.body).toBe('Carefully written.');
		// Still pending, so it can be retried.
		expect(row.status).toBe('pending');
	});

	it('records who sent it', async () => {
		const steward = await seedUser(db);
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 's3' });
		const pending = (await listPendingEmails()).find((p) => p.userId === u.id)!;

		await sendQueuedEmail(pending.id, steward.id);
		const [row] = await db
			.select()
			.from(schema.memberEmails)
			.where(eq(schema.memberEmails.id, pending.id));
		expect(row.sentBy).toBe(steward.id);
		expect(row.status).toBe('sent');
	});

	it('refuses to send the same draft twice', async () => {
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 's4' });
		const pending = (await listPendingEmails()).find((p) => p.userId === u.id)!;

		expect((await sendQueuedEmail(pending.id, u.id)).ok).toBe(true);
		expect((await sendQueuedEmail(pending.id, u.id)).ok).toBe(false);
	});
});

describe('dismissing a draft', () => {
	it('records the decision rather than deleting it', async () => {
		const steward = await seedUser(db);
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 'd1' });
		const pending = (await listPendingEmails()).find((p) => p.userId === u.id)!;

		const result = await dismissQueuedEmail(pending.id, steward.id, 'spoke in person');
		expect(result.ok).toBe(true);

		const [row] = await db
			.select()
			.from(schema.memberEmails)
			.where(eq(schema.memberEmails.id, pending.id));
		expect(row.status).toBe('dismissed');
		expect(row.dismissedReason).toBe('spoke in person');
		expect(mail.sendEmail).not.toHaveBeenCalled();
	});

	it('cannot dismiss something already sent', async () => {
		const u = await seedUser(db);
		await draft(u.id, u.email, { relatedId: 'd2' });
		const pending = (await listPendingEmails()).find((p) => p.userId === u.id)!;

		await sendQueuedEmail(pending.id, u.id);
		expect((await dismissQueuedEmail(pending.id, u.id)).ok).toBe(false);
	});
});
