import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';

const { db } = createTestDb();

vi.mock('$lib/server/db', () => ({ db }));

// Every external system is stubbed. The point of these tests is the *ordering*
// and the failure handling — that a Discord outage cannot leave someone half
// removed, and that the local status change lands regardless.
const authentik = vi.hoisted(() => ({
	getAuthentikGroupByName: vi.fn(async () => 'group-uuid'),
	getAuthentikUserByEmail: vi.fn(async () => 42),
	removeUserFromAuthentikGroup: vi.fn(async () => {}),
	setAuthentikUserActive: vi.fn(async () => {})
}));
vi.mock('$lib/server/authentik', () => authentik);

const listmonk = vi.hoisted(() => ({ unsubscribeFromNewsletter: vi.fn(async () => true) }));
vi.mock('$lib/server/listmonk', () => listmonk);

const discord = vi.hoisted(() => ({
	removeDiscordMemberRole: vi.fn(async () => true),
	sendDiscordMessage: vi.fn(async () => true)
}));
vi.mock('$lib/server/discord', () => discord);

class NotFound extends Error {}
vi.mock('@offcoin/sdk', () => ({ NotFoundError: NotFound }));

const offcoinMembers = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
const offcoin = vi.hoisted(() => ({
	getOffcoinClient: vi.fn(),
	memberAlias: vi.fn((id: string) => `puckstack:ws:${id}`)
}));
vi.mock('$lib/server/offcoin', () => offcoin);

const { executeExit } = await import('./membership-exit');

beforeEach(() => {
	vi.clearAllMocks();
	authentik.getAuthentikGroupByName.mockResolvedValue('group-uuid');
	authentik.getAuthentikUserByEmail.mockResolvedValue(42);
	authentik.setAuthentikUserActive.mockResolvedValue(undefined);
	listmonk.unsubscribeFromNewsletter.mockResolvedValue(true);
	discord.removeDiscordMemberRole.mockResolvedValue(true);
	offcoinMembers.get.mockResolvedValue({ aliases: ['puckstack:ws:ps1', 'discord:12345'] });
	offcoinMembers.delete.mockResolvedValue({ deleted: true });
	offcoin.getOffcoinClient.mockReturnValue({ members: offcoinMembers });
});

describe('executeExit', () => {
	it('sets the status, which is what actually denies access', async () => {
		const u = await seedUser(db);
		const result = await executeExit(u.id, 'Left the community', null);

		expect(result.statusSet).toBe(true);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('exited');
		expect(after.exitReason).toBe('Left the community');
	});

	it('deactivates the Authentik account, not just the groups', async () => {
		// Group removal alone would leave them able to sign in — a trial member is
		// defined by the absence of a role, so a stripped account looks like a new
		// one rather than a departed one.
		const u = await seedUser(db);
		await executeExit(u.id, 'reason', null);

		expect(authentik.removeUserFromAuthentikGroup).toHaveBeenCalled();
		expect(authentik.setAuthentikUserActive).toHaveBeenCalledWith(42, false);
	});

	it('revokes sessions so the exit does not wait for expiry', async () => {
		const u = await seedUser(db);
		const now = new Date();
		await db.insert(schema.session).values({
			id: 's1',
			userId: u.id,
			token: 't1',
			expiresAt: new Date(now.getTime() + 86_400_000),
			createdAt: now,
			updatedAt: now
		});

		const result = await executeExit(u.id, 'reason', null);
		expect(result.sessionsRevoked).toBe(1);

		const left = await db.select().from(schema.session).where(eq(schema.session.userId, u.id));
		expect(left).toHaveLength(0);
	});

	it('drops them from the public roster', async () => {
		const u = await seedUser(db, { showOnWebsite: true });
		await executeExit(u.id, 'reason', null);

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.showOnWebsite).toBe(false);
		expect(after.groups).toBe('[]');
	});

	it('records who decided and why', async () => {
		const actor = await seedUser(db);
		const u = await seedUser(db);
		await executeExit(u.id, 'Broke participation rules', actor.id);

		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, u.id));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			toStatus: 'exited',
			reason: 'Broke participation rules',
			actorUserId: actor.id
		});
	});

	it('still exits when every external system fails', async () => {
		// The half that matters is local. An Authentik outage must not mean the
		// member keeps OS access while everyone believes they were removed.
		authentik.getAuthentikUserByEmail.mockRejectedValue(new Error('authentik down'));
		listmonk.unsubscribeFromNewsletter.mockResolvedValue(false);
		discord.removeDiscordMemberRole.mockResolvedValue(false);

		const u = await seedUser(db);
		const result = await executeExit(u.id, 'reason', null);

		expect(result.statusSet).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('exited');
	});

	it('reports each system that did not complete, rather than failing silently', async () => {
		listmonk.unsubscribeFromNewsletter.mockResolvedValue(false);
		const u = await seedUser(db);
		const result = await executeExit(u.id, 'reason', null);

		expect(result.newsletterUnsubscribed).toBe(false);
		expect(result.warnings.join(' ')).toContain('Newsletter');
	});

	it('is idempotent — re-running an exit does not break', async () => {
		const u = await seedUser(db);
		await executeExit(u.id, 'first', null);
		const second = await executeExit(u.id, 'second', null);

		expect(second.statusSet).toBe(true);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.membershipStatus).toBe('exited');
	});

	it('reports a missing user instead of throwing', async () => {
		const result = await executeExit('nobody', 'reason', null);
		expect(result.statusSet).toBe(false);
		expect(result.warnings).toContain('User not found');
	});
});

describe('clearing the Offcoin economy', () => {
	it('deletes the member, so re-application really starts from zero', async () => {
		// Without this the alias — derived from the Puckstack user id — resolves to
		// the old member on re-application, and the level webhook promotes them
		// past trial on arrival.
		const u = await seedUser(db, { puckstackUserId: 'ps1' });
		const result = await executeExit(u.id, 'Left', null);

		expect(offcoinMembers.delete).toHaveBeenCalledWith('puckstack:ws:ps1');
		expect(result.offcoinMemberDeleted).toBe(true);
	});

	it('reads the Discord id before deleting, not after', async () => {
		// The Discord user id is only stored as an alias on the Offcoin member, so
		// deleting first would destroy the means of stripping the Discord role.
		const order: string[] = [];
		offcoinMembers.get.mockImplementation(async () => {
			order.push('get');
			return { aliases: ['puckstack:ws:ps1', 'discord:12345'] };
		});
		offcoinMembers.delete.mockImplementation(async () => {
			order.push('delete');
			return { deleted: true };
		});

		const u = await seedUser(db, { puckstackUserId: 'ps1' });
		await executeExit(u.id, 'Left', null);

		expect(order).toEqual(['get', 'delete']);
		expect(discord.removeDiscordMemberRole).toHaveBeenCalledWith('12345');
	});

	it('clears the local level snapshot, which gates a returning member', async () => {
		const u = await seedUser(db, { puckstackUserId: 'ps1', offcoinXp: 900, offcoinLevel: 4 });
		await executeExit(u.id, 'Left', null);

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.offcoinLevel).toBeNull();
		expect(after.offcoinXp).toBeNull();
		expect(after.offcoinMemberId).toBeNull();
	});

	it('treats an already-deleted member as done', async () => {
		const u = await seedUser(db, { puckstackUserId: 'ps1' });
		offcoinMembers.delete.mockRejectedValue(new NotFound('gone'));

		const result = await executeExit(u.id, 'Left', null);

		expect(result.offcoinMemberDeleted).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	it('warns rather than failing when Offcoin is unreachable', async () => {
		const u = await seedUser(db, { puckstackUserId: 'ps1' });
		offcoinMembers.delete.mockRejectedValue(new Error('connection reset'));

		const result = await executeExit(u.id, 'Left', null);

		expect(result.statusSet).toBe(true);
		expect(result.offcoinMemberDeleted).toBe(false);
		expect(result.warnings.join(' ')).toContain('resume the old level');
		// The snapshot still goes: it describes a member that should not exist.
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, u.id));
		expect(after.offcoinLevel).toBeNull();
	});

	it('skips Offcoin entirely for a member who never connected', async () => {
		const u = await seedUser(db, { puckstackUserId: null });
		const result = await executeExit(u.id, 'Left', null);

		expect(offcoinMembers.delete).not.toHaveBeenCalled();
		expect(result.statusSet).toBe(true);
		// Nothing to delete is the end state we wanted, not unfinished cleanup —
		// the flag documents itself that way, so it has to agree.
		expect(result.offcoinMemberDeleted).toBe(true);
	});
});
