import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { GRANT_GROUPS, ROLE_GROUPS } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const authentik = vi.hoisted(() => ({
	getAuthentikGroupByName: vi.fn(async () => 'group-uuid'),
	getAuthentikUserByEmail: vi.fn(async () => 42),
	addUserToAuthentikGroup: vi.fn(async () => {}),
	removeUserFromAuthentikGroup: vi.fn(async () => {})
}));
vi.mock('$lib/server/authentik', () => authentik);

const { setGroupMembership, isManageableGroup, MANAGEABLE_GROUPS } = await import('./group-grants');

beforeEach(() => {
	vi.clearAllMocks();
	// clearAllMocks resets calls but not implementations, so a rejection set by
	// one test leaks into the next. Restore all four explicitly.
	authentik.getAuthentikGroupByName.mockResolvedValue('group-uuid');
	authentik.getAuthentikUserByEmail.mockResolvedValue(42);
	authentik.addUserToAuthentikGroup.mockResolvedValue(undefined);
	authentik.removeUserFromAuthentikGroup.mockResolvedValue(undefined);
});

describe('the allowlist', () => {
	// This is the security boundary. An endpoint that forwards an arbitrary group
	// name to Authentik is a way to grant anything the identity provider knows
	// about, including groups that gate entirely different systems.
	it('refuses a group it does not manage, without calling Authentik', async () => {
		const admin = await seedUser(db);
		const target = await seedUser(db);

		const result = await setGroupMembership({
			userId: target.id,
			group: 'Some Other System Admins',
			action: 'add',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(false);
		expect(authentik.addUserToAuthentikGroup).not.toHaveBeenCalled();
	});

	it('refuses EcoHubs Admin — minting admins stays out-of-band', async () => {
		expect(isManageableGroup('EcoHubs Admin')).toBe(false);
	});

	it('refuses EcoHubs Member — the level-up webhook owns it', async () => {
		expect(isManageableGroup(ROLE_GROUPS.member)).toBe(false);
	});

	it('allows exactly Steward and the four tool grants', () => {
		expect(Object.keys(MANAGEABLE_GROUPS).sort()).toEqual(
			[
				ROLE_GROUPS.steward,
				GRANT_GROUPS.blog,
				GRANT_GROUPS.newsletter,
				GRANT_GROUPS.blueprint,
				GRANT_GROUPS.social
			].sort()
		);
	});
});

describe('granting', () => {
	it('writes to Authentik and mirrors locally for immediate effect', async () => {
		const admin = await seedUser(db);
		const target = await seedUser(db, { groups: JSON.stringify([]) });

		const result = await setGroupMembership({
			userId: target.id,
			group: GRANT_GROUPS.newsletter,
			action: 'add',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(true);
		expect(authentik.addUserToAuthentikGroup).toHaveBeenCalledWith('group-uuid', 42);

		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
		expect(JSON.parse(after.groups!)).toContain(GRANT_GROUPS.newsletter);
	});

	it('does not touch Authentik when already in the desired state', async () => {
		const admin = await seedUser(db);
		const target = await seedUser(db, { groups: JSON.stringify([GRANT_GROUPS.blog]) });

		const result = await setGroupMembership({
			userId: target.id,
			group: GRANT_GROUPS.blog,
			action: 'add',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(true);
		expect(authentik.addUserToAuthentikGroup).not.toHaveBeenCalled();
	});

	it('leaves the local mirror alone when Authentik rejects the change', async () => {
		// A mirror claiming a group the identity provider does not grant would be
		// worse than an error — the OS would show access that does not exist.
		authentik.addUserToAuthentikGroup.mockRejectedValue(new Error('authentik down'));
		const admin = await seedUser(db);
		const target = await seedUser(db, { groups: JSON.stringify([]) });

		const result = await setGroupMembership({
			userId: target.id,
			group: GRANT_GROUPS.social,
			action: 'add',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(false);
		const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
		expect(JSON.parse(after.groups!)).toEqual([]);
	});
});

describe('the audit trail', () => {
	it('records a role change', async () => {
		const admin = await seedUser(db);
		const target = await seedUser(db, { groups: JSON.stringify([ROLE_GROUPS.member]) });

		await setGroupMembership({
			userId: target.id,
			group: ROLE_GROUPS.steward,
			action: 'add',
			actorUserId: admin.id
		});

		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, target.id));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ toRole: 'steward', actorUserId: admin.id });
	});

	it('does not record a tool grant — that is access, not standing', async () => {
		// Recording every newsletter toggle would bury the transitions that matter.
		const admin = await seedUser(db);
		const target = await seedUser(db, { groups: JSON.stringify([]) });

		await setGroupMembership({
			userId: target.id,
			group: GRANT_GROUPS.blog,
			action: 'add',
			actorUserId: admin.id
		});

		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, target.id));
		expect(events).toHaveLength(0);
	});
});

describe('self-inflicted changes', () => {
	it('blocks removing your own steward role', async () => {
		// It takes away the app you are standing in, and recovery means asking
		// someone else to put it back.
		const admin = await seedUser(db, { groups: JSON.stringify([ROLE_GROUPS.steward]) });

		const result = await setGroupMembership({
			userId: admin.id,
			group: ROLE_GROUPS.steward,
			action: 'remove',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(false);
		expect(authentik.removeUserFromAuthentikGroup).not.toHaveBeenCalled();
	});

	it('still lets you remove your own tool grants', async () => {
		const admin = await seedUser(db, { groups: JSON.stringify([GRANT_GROUPS.blog]) });

		const result = await setGroupMembership({
			userId: admin.id,
			group: GRANT_GROUPS.blog,
			action: 'remove',
			actorUserId: admin.id
		});

		expect(result.ok).toBe(true);
	});
});
