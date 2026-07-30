import { describe, it, expect } from 'vitest';
import {
	POLICY,
	CAPABILITIES,
	ROLE_GROUPS,
	GRANT_GROUPS,
	can,
	allowed,
	appSurface,
	isRequestable,
	resolveRole,
	isAtLeastRole,
	type Capability,
	type MemberContext,
	type MembershipStatus,
	type Role
} from './policy';

/** Build a context; defaults to a trial member with no Offcoin level. */
function ctx(overrides: Partial<MemberContext> = {}): MemberContext {
	return { groups: [], status: 'active', level: 0, ...overrides };
}

const trial = (o: Partial<MemberContext> = {}) => ctx(o);
const member = (o: Partial<MemberContext> = {}) =>
	ctx({ groups: [ROLE_GROUPS.member], level: 1, ...o });
const steward = (o: Partial<MemberContext> = {}) =>
	ctx({ groups: [ROLE_GROUPS.member, ROLE_GROUPS.steward], level: 3, ...o });
const admin = (o: Partial<MemberContext> = {}) =>
	ctx({ groups: [ROLE_GROUPS.member, ROLE_GROUPS.steward, ROLE_GROUPS.admin], level: 3, ...o });

describe('resolveRole', () => {
	it('treats the absence of every role group as trial', () => {
		expect(resolveRole([])).toBe('trial');
	});

	it('ignores unknown and grant groups when resolving', () => {
		expect(resolveRole(['Some Other Group', GRANT_GROUPS.blog])).toBe('trial');
		expect(resolveRole([ROLE_GROUPS.member, GRANT_GROUPS.social])).toBe('member');
	});

	it('picks the highest role when roles are additive', () => {
		expect(resolveRole([ROLE_GROUPS.member, ROLE_GROUPS.steward])).toBe('steward');
		expect(resolveRole([ROLE_GROUPS.member, ROLE_GROUPS.steward, ROLE_GROUPS.admin])).toBe('admin');
	});

	it('resolves a role held without Member, since roles are ranked not summed', () => {
		expect(resolveRole([ROLE_GROUPS.admin])).toBe('admin');
	});
});

describe('isAtLeastRole', () => {
	it('orders trial < member < steward < admin', () => {
		expect(isAtLeastRole('admin', 'steward')).toBe(true);
		expect(isAtLeastRole('steward', 'member')).toBe(true);
		expect(isAtLeastRole('member', 'trial')).toBe(true);
		expect(isAtLeastRole('member', 'steward')).toBe(false);
		expect(isAtLeastRole('trial', 'member')).toBe(false);
	});

	it('is inclusive of the role itself', () => {
		expect(isAtLeastRole('member', 'member')).toBe(true);
	});
});

describe('voting rights', () => {
	it('denies trial members the vote and points at the unlock level', () => {
		const result = can('proposal.vote', trial());
		expect(result).toMatchObject({
			allowed: false,
			reason: 'needs_role',
			requiredRole: 'member',
			currentRole: 'trial',
			unlockAtLevel: POLICY.levels.memberFromLevel,
			currentLevel: 0
		});
	});

	it('explains the unlock in member-facing copy', () => {
		const result = can('proposal.vote', trial());
		expect(result.allowed).toBe(false);
		if (result.allowed) return;
		expect(result.message).toBe(
			"Voting unlocks when you reach Offcoin Level 1. You're at Level 0."
		);
	});

	it('lets members, stewards and admins vote', () => {
		expect(allowed('proposal.vote', member())).toBe(true);
		expect(allowed('proposal.vote', steward())).toBe(true);
		expect(allowed('proposal.vote', admin())).toBe(true);
	});

	it('gives trial members read-only access to the Voting app', () => {
		expect(allowed('voting.view', trial())).toBe(true);
		expect(allowed('proposal.vote', trial())).toBe(false);
	});
});

describe('proposal creation', () => {
	it('is closed to members — stewards and admins only', () => {
		expect(allowed('proposal.create', member())).toBe(false);
		expect(allowed('proposal.create', steward())).toBe(true);
		expect(allowed('proposal.create', admin())).toBe(true);
	});

	it('offers no automatic unlock level, because steward is request + approval', () => {
		const result = can('proposal.create', member());
		expect(result).toMatchObject({ reason: 'needs_role', unlockAtLevel: null });
	});

	it('tells a level-eligible member they can ask to become a steward', () => {
		const result = can('proposal.create', member({ level: POLICY.levels.stewardMinLevel }));
		expect(result.allowed).toBe(false);
		if (result.allowed) return;
		expect(result.message).toContain('ask an admin about becoming a steward');
	});

	it('does not dangle stewardship at a member below the level bar', () => {
		const result = can('proposal.create', member({ level: 1 }));
		expect(result.allowed).toBe(false);
		if (result.allowed) return;
		expect(result.message).not.toContain('ask an admin');
	});
});

describe('requestable grants', () => {
	it('locks newsletter writing for a member without the grant', () => {
		const result = can('newsletter.write', member());
		expect(result).toMatchObject({
			allowed: false,
			reason: 'needs_grant',
			missingGrant: GRANT_GROUPS.newsletter,
			appVisibility: 'locked'
		});
		expect(isRequestable(result)).toBe(true);
	});

	it('opens it once the grant group is held', () => {
		expect(
			allowed('newsletter.write', member({ groups: [ROLE_GROUPS.member, GRANT_GROUPS.newsletter] }))
		).toBe(true);
	});

	it('keeps each tool independently requestable', () => {
		const withBlog = member({ groups: [ROLE_GROUPS.member, GRANT_GROUPS.blog] });
		expect(allowed('blog.write', withBlog)).toBe(true);
		expect(allowed('newsletter.write', withBlog)).toBe(false);
		expect(allowed('blueprint.admin', withBlog)).toBe(false);
		expect(allowed('social.post', withBlog)).toBe(false);
	});

	it('hides grant-gated tools from trial members rather than inviting a request', () => {
		const result = can('newsletter.write', trial());
		expect(result).toMatchObject({ reason: 'needs_role', appVisibility: 'hidden' });
		expect(isRequestable(result)).toBe(false);
	});

	it('does not require a grant for capabilities that have none', () => {
		expect(allowed('buddy.host', member())).toBe(true);
	});
});

describe('standby', () => {
	it('keeps OS access, so there is a route in to request reactivation', () => {
		expect(allowed('os.access', member({ status: 'standby' }))).toBe(true);
		expect(allowed('os.access', trial({ status: 'standby' }))).toBe(true);
	});

	it('suspends voting with a status reason, not a role reason', () => {
		const result = can('proposal.vote', member({ status: 'standby' }));
		expect(result).toMatchObject({
			allowed: false,
			reason: 'needs_status',
			appVisibility: 'locked'
		});
	});

	it('tells a standby member to reactivate', () => {
		const result = can('proposal.vote', member({ status: 'standby' }));
		expect(result.allowed).toBe(false);
		if (result.allowed) return;
		expect(result.message).toBe(
			'Your membership is on standby. Reactivate it to use voting again.'
		);
	});

	it('suspends steward and admin powers too — status is orthogonal to role', () => {
		expect(allowed('onboarding.manage', steward({ status: 'standby' }))).toBe(false);
		expect(allowed('admin.apps', admin({ status: 'standby' }))).toBe(false);
		expect(allowed('rewards.grant', admin({ status: 'standby' }))).toBe(false);
	});

	it('reports the role a standby member still holds', () => {
		const result = can('admin.apps', admin({ status: 'standby' }));
		expect(result).toMatchObject({ currentRole: 'admin', reason: 'needs_status' });
	});

	it('prefers the role reason when a standby member also lacks the role', () => {
		// Reactivating alone would not grant the vote, so saying "reactivate to
		// vote" would be a lie.
		const result = can('proposal.vote', trial({ status: 'standby' }));
		expect(result).toMatchObject({ reason: 'needs_role' });
	});
});

describe('exited members', () => {
	it('denies everything, including OS access', () => {
		expect(allowed('os.access', member({ status: 'exited' }))).toBe(false);
		expect(allowed('voting.view', member({ status: 'exited' }))).toBe(false);
	});

	it('denies access even when Authentik group removal has not caught up', () => {
		// The local `user.groups` mirror can lag Authentik. Status must win.
		expect(allowed('admin.apps', admin({ status: 'exited' }))).toBe(false);
		expect(allowed('os.access', admin({ status: 'exited' }))).toBe(false);
	});

	it('never leaks an exited member back in as a trial member', () => {
		// Trial is the ABSENCE of a role, so a stripped-group exited account
		// resolves to `trial` — status has to be checked first.
		const stripped = ctx({ groups: [], status: 'exited' });
		expect(resolveRole(stripped.groups)).toBe('trial');
		expect(allowed('os.access', stripped)).toBe(false);
		expect(allowed('voting.view', stripped)).toBe(false);
	});

	it('hides rather than locks, and says nothing about reactivating', () => {
		const result = can('voting.view', member({ status: 'exited' }));
		expect(result).toMatchObject({ appVisibility: 'hidden', reason: 'needs_status' });
		if (result.allowed) return;
		expect(result.message).toBe('Your EcoHubs membership has ended.');
	});
});

describe('appSurface', () => {
	it('hides what needs a role, locks what needs a grant, opens the rest', () => {
		expect(appSurface('newsletter.write', trial())).toBe('hidden');
		expect(appSurface('newsletter.write', member())).toBe('locked');
		expect(
			appSurface(
				'newsletter.write',
				member({ groups: [ROLE_GROUPS.member, GRANT_GROUPS.newsletter] })
			)
		).toBe('open');
	});

	it('locks — not hides — an app a standby member normally has', () => {
		expect(appSurface('onboarding.manage', steward({ status: 'standby' }))).toBe('locked');
	});

	it('hides admin apps from everyone below admin', () => {
		expect(appSurface('admin.apps', trial())).toBe('hidden');
		expect(appSurface('admin.apps', member())).toBe('hidden');
		expect(appSurface('admin.apps', steward())).toBe('hidden');
		expect(appSurface('admin.apps', admin())).toBe('open');
	});
});

describe('steward and admin capabilities', () => {
	it('lets stewards grant rewards, run onboarding, and exit members', () => {
		expect(allowed('rewards.grant', steward())).toBe(true);
		expect(allowed('onboarding.manage', steward())).toBe(true);
		expect(allowed('membership.exit', steward())).toBe(true);
	});

	it('withholds those from plain members', () => {
		expect(allowed('rewards.grant', member())).toBe(false);
		expect(allowed('onboarding.manage', member())).toBe(false);
		expect(allowed('membership.exit', member())).toBe(false);
	});

	it('reserves admin apps for admins alone', () => {
		expect(allowed('admin.apps', steward())).toBe(false);
		expect(allowed('admin.apps', admin())).toBe(true);
	});
});

describe('policy is the single tuning surface', () => {
	const ALL: Capability[] = Object.keys(CAPABILITIES) as Capability[];

	it('exposes the capability table through POLICY', () => {
		expect(POLICY.capabilities).toBe(CAPABILITIES);
	});

	it('gives every capability a label and at least one permitted status', () => {
		for (const cap of ALL) {
			expect(CAPABILITIES[cap].label.length, cap).toBeGreaterThan(0);
			expect(CAPABILITIES[cap].statuses.length, cap).toBeGreaterThan(0);
		}
	});

	it('never permits a capability while exited', () => {
		for (const cap of ALL) {
			expect(CAPABILITIES[cap].statuses).not.toContain('exited' as MembershipStatus);
		}
	});

	it('grants every capability to an active admin', () => {
		const fullAdmin = admin({
			groups: [...Object.values(ROLE_GROUPS), ...Object.values(GRANT_GROUPS)]
		});
		for (const cap of ALL) {
			expect(allowed(cap, fullAdmin), cap).toBe(true);
		}
	});

	it('derives unlock copy from memberFromLevel rather than hardcoding it', () => {
		const result = can('proposal.vote', trial());
		if (result.allowed) throw new Error('expected denial');
		expect(result.message).toContain(`Level ${POLICY.levels.memberFromLevel}`);
		expect(result.unlockAtLevel).toBe(POLICY.levels.memberFromLevel);
	});

	it('models reactivation on the existing 3-day operational vote', () => {
		expect(POLICY.reactivation.proposalType).toBe('operational');
	});

	it('does not let silence reject a reactivation', () => {
		expect(POLICY.reactivation.zeroVotesResult).toBe('needs_review');
	});

	it('keeps voter reasons private from a rejected member', () => {
		expect(POLICY.reactivation.discloseVoterReasons).toBe(false);
	});

	it('blocks self-grants and negative grants', () => {
		expect(POLICY.grants.allowSelfGrant).toBe(false);
		expect(POLICY.grants.allowNegative).toBe(false);
	});

	it('applies one grant cap to stewards and admins alike', () => {
		expect(POLICY.grants.maxXpPerActorPerDay).toBeGreaterThanOrEqual(POLICY.grants.maxXpPerGrant);
	});
});

describe('level changes alone do not change access', () => {
	it('keeps a high-level trial member out until the Member group is assigned', () => {
		// Promotion is applied by the Offcoin webhook granting the group — level
		// on its own is not a gate, so a lag cannot silently grant rights.
		const highLevelTrial = trial({ level: 99 });
		expect(allowed('proposal.vote', highLevelTrial)).toBe(false);
		expect(resolveRole(highLevelTrial.groups)).toBe('trial');
	});

	it('keeps a level-0 member voting, so an Offcoin outage cannot demote them', () => {
		expect(allowed('proposal.vote', member({ level: 0 }))).toBe(true);
	});
});

describe('exhaustive role × status matrix', () => {
	const ROLES: Role[] = ['trial', 'member', 'steward', 'admin'];
	const STATUSES: MembershipStatus[] = ['active', 'standby', 'exited'];
	const GROUPS_FOR: Record<Role, string[]> = {
		trial: [],
		member: [ROLE_GROUPS.member],
		steward: [ROLE_GROUPS.member, ROLE_GROUPS.steward],
		admin: [ROLE_GROUPS.member, ROLE_GROUPS.steward, ROLE_GROUPS.admin]
	};

	it('returns a decision for every combination without throwing', () => {
		for (const role of ROLES) {
			for (const status of STATUSES) {
				for (const cap of Object.keys(CAPABILITIES) as Capability[]) {
					const result = can(cap, { groups: GROUPS_FOR[role], status, level: 0 });
					expect(typeof result.allowed, `${role}/${status}/${cap}`).toBe('boolean');
					if (!result.allowed) {
						expect(result.message.length, `${role}/${status}/${cap}`).toBeGreaterThan(0);
					}
				}
			}
		}
	});

	it('grants os.access to every non-exited role and to none that are exited', () => {
		for (const role of ROLES) {
			expect(allowed('os.access', { groups: GROUPS_FOR[role], status: 'active', level: 0 })).toBe(
				true
			);
			expect(allowed('os.access', { groups: GROUPS_FOR[role], status: 'standby', level: 0 })).toBe(
				true
			);
			expect(allowed('os.access', { groups: GROUPS_FOR[role], status: 'exited', level: 0 })).toBe(
				false
			);
		}
	});
});
