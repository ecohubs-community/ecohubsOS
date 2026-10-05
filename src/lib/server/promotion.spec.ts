/**
 * Trial → Member promotion.
 *
 * Runs against the real schema so the group mirror and the audit row are
 * checked as written, not as a mock was told to expect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from './test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { POLICY, ROLE_GROUPS } from '$lib/policy';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));

const authentik = vi.hoisted(() => ({
	getAuthentikGroupByName: vi.fn(),
	getAuthentikUserByEmail: vi.fn(),
	addUserToAuthentikGroup: vi.fn()
}));
vi.mock('$lib/server/authentik', () => authentik);

const { promoteIfEligible, isEligibleForPromotion } = await import('./promotion');

const LEVEL = POLICY.levels.memberFromLevel;
const asTrial = JSON.stringify([]);

beforeEach(() => {
	vi.clearAllMocks();
	authentik.getAuthentikGroupByName.mockResolvedValue('group-uuid');
	authentik.getAuthentikUserByEmail.mockResolvedValue(42);
	authentik.addUserToAuthentikGroup.mockResolvedValue(undefined);
});

async function reload(id: string) {
	const [row] = await db.select().from(schema.user).where(eq(schema.user.id, id));
	return row;
}

describe('promoteIfEligible', () => {
	it('grants Member in Authentik, mirrors it locally and records why', async () => {
		const u = await seedUser(db, { groups: asTrial });

		const outcome = await promoteIfEligible(u.id, LEVEL);

		expect(outcome).toEqual({ kind: 'promoted' });
		expect(authentik.addUserToAuthentikGroup).toHaveBeenCalledWith('group-uuid', 42);
		expect(JSON.parse((await reload(u.id)).groups!)).toContain(ROLE_GROUPS.member);
		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, u.id));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ fromRole: 'trial', toRole: 'member', actorUserId: null });
	});

	it('leaves a trial member under the level alone', async () => {
		const u = await seedUser(db, { groups: asTrial });

		expect(await promoteIfEligible(u.id, LEVEL - 1)).toEqual({ kind: 'not_eligible' });
		expect(authentik.addUserToAuthentikGroup).not.toHaveBeenCalled();
	});

	it('does nothing for someone already a member — a re-run cannot double-apply', async () => {
		const u = await seedUser(db, { groups: JSON.stringify([ROLE_GROUPS.member]) });

		expect(await promoteIfEligible(u.id, LEVEL + 3)).toEqual({ kind: 'not_eligible' });
		expect(authentik.addUserToAuthentikGroup).not.toHaveBeenCalled();
	});

	it('does not promote a standby member — reactivation is a vote, not a level', async () => {
		const u = await seedUser(db, { groups: asTrial, membershipStatus: 'standby' });

		expect(await promoteIfEligible(u.id, LEVEL)).toEqual({ kind: 'not_eligible' });
	});

	it('reads the row fresh, so a stale caller copy cannot promote twice', async () => {
		const u = await seedUser(db, { groups: asTrial });

		await promoteIfEligible(u.id, LEVEL);
		await promoteIfEligible(u.id, LEVEL);

		expect(authentik.addUserToAuthentikGroup).toHaveBeenCalledTimes(1);
	});

	it('reports an Authentik failure instead of throwing, and changes nothing locally', async () => {
		const u = await seedUser(db, { groups: asTrial });
		authentik.addUserToAuthentikGroup.mockRejectedValue(new Error('403 forbidden'));

		const outcome = await promoteIfEligible(u.id, LEVEL);

		expect(outcome).toEqual({ kind: 'failed', error: '403 forbidden' });
		expect(JSON.parse((await reload(u.id)).groups!)).toEqual([]);
		const events = await db
			.select()
			.from(schema.membershipEvents)
			.where(eq(schema.membershipEvents.userId, u.id));
		expect(events).toHaveLength(0);
	});

	it('reports a missing Authentik user', async () => {
		const u = await seedUser(db, { groups: asTrial });
		authentik.getAuthentikUserByEmail.mockResolvedValue(null);

		expect((await promoteIfEligible(u.id, LEVEL)).kind).toBe('failed');
	});
});

describe('isEligibleForPromotion', () => {
	it('treats unreadable groups as trial', () => {
		expect(isEligibleForPromotion({ groups: 'not json', membershipStatus: 'active' }, LEVEL)).toBe(
			true
		);
	});
});
