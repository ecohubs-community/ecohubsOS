import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getMemberContext,
	check,
	hasCapability,
	requireCapability,
	currentRole,
	currentStatus
} from './membership';
import { ROLE_GROUPS, GRANT_GROUPS, POLICY } from '$lib/policy';

type Locals = RequestEvent['locals'];

/**
 * Minimal stand-in for `locals`. Only `user.groups` (a JSON string, as stored)
 * and the pending membership fields matter to this module.
 */
function locals(groups: string[] | null, extra: Record<string, unknown> = {}): Locals {
	if (groups === null) return { user: null, session: null } as unknown as Locals;
	return {
		user: { id: 'u1', email: 'a@b.c', groups: JSON.stringify(groups), ...extra },
		session: null
	} as unknown as Locals;
}

/** Capture the HttpError a guard throws. */
function thrown(fn: () => void): { status: number; message: string } {
	try {
		fn();
	} catch (e) {
		const err = e as { status: number; body?: { message?: string } };
		return { status: err.status, message: err.body?.message ?? '' };
	}
	throw new Error('expected a throw');
}

describe('getMemberContext', () => {
	it('parses the JSON group string off locals', () => {
		const ctx = getMemberContext(locals([ROLE_GROUPS.member, GRANT_GROUPS.blog]));
		expect(ctx.groups).toEqual([ROLE_GROUPS.member, GRANT_GROUPS.blog]);
	});

	it('survives malformed group JSON rather than throwing mid-request', () => {
		const bad = { user: { groups: '{not json' }, session: null } as unknown as Locals;
		expect(getMemberContext(bad).groups).toEqual([]);
	});

	it('defaults status to active until the migration lands', () => {
		expect(getMemberContext(locals([])).status).toBe('active');
	});

	it('reads the real status once the column exists', () => {
		expect(getMemberContext(locals([], { membershipStatus: 'standby' })).status).toBe('standby');
	});

	it('defaults level to 0 and reads the snapshot when present', () => {
		expect(getMemberContext(locals([])).level).toBe(0);
		expect(getMemberContext(locals([], { offcoinLevel: 4 })).level).toBe(4);
	});

	it('lets a call site override the level it already knows', () => {
		expect(getMemberContext(locals([]), { level: 7 }).level).toBe(7);
	});
});

describe('requireCapability', () => {
	it('401s an unauthenticated caller', () => {
		expect(thrown(() => requireCapability('proposal.vote', locals(null)))).toMatchObject({
			status: 401
		});
	});

	it('401 takes precedence over any capability reasoning', () => {
		// Even os.access, which trial members hold, must not report 403 for a
		// caller who has no session at all.
		expect(thrown(() => requireCapability('os.access', locals(null))).status).toBe(401);
	});

	it('403s a trial member trying to vote, with the policy message', () => {
		const err = thrown(() => requireCapability('proposal.vote', locals([])));
		expect(err.status).toBe(403);
		expect(err.message).toContain(`Level ${POLICY.levels.memberFromLevel}`);
	});

	it('passes a member through', () => {
		expect(() => requireCapability('proposal.vote', locals([ROLE_GROUPS.member]))).not.toThrow();
	});

	it('403s a member on proposal creation — stewards and admins only', () => {
		expect(
			thrown(() => requireCapability('proposal.create', locals([ROLE_GROUPS.member]))).status
		).toBe(403);
		expect(() =>
			requireCapability('proposal.create', locals([ROLE_GROUPS.member, ROLE_GROUPS.steward]))
		).not.toThrow();
	});

	it('403s an exited member even while their groups linger', () => {
		const err = thrown(() =>
			requireCapability(
				'os.access',
				locals(Object.values(ROLE_GROUPS), { membershipStatus: 'exited' })
			)
		);
		expect(err.status).toBe(403);
		expect(err.message).toBe('Your EcoHubs membership has ended.');
	});

	it('lets a standby member reach the OS to request reactivation', () => {
		expect(() =>
			requireCapability('os.access', locals([ROLE_GROUPS.member], { membershipStatus: 'standby' }))
		).not.toThrow();
	});

	it('uses an overridden level in the denial message', () => {
		const err = thrown(() =>
			requireCapability('proposal.create', locals([ROLE_GROUPS.member]), {
				level: POLICY.levels.stewardMinLevel
			})
		);
		expect(err.message).toContain('ask an admin about becoming a steward');
	});
});

describe('check', () => {
	it('reports needs_grant so a caller can offer a Request access path', () => {
		const result = check('newsletter.write', locals([ROLE_GROUPS.member]));
		expect(result).toMatchObject({
			allowed: false,
			reason: 'needs_grant',
			missingGrant: GRANT_GROUPS.newsletter
		});
	});

	it('allows once the grant group is held', () => {
		expect(
			check('newsletter.write', locals([ROLE_GROUPS.member, GRANT_GROUPS.newsletter])).allowed
		).toBe(true);
	});

	it('does not throw for an unauthenticated caller', () => {
		expect(() => check('proposal.vote', locals(null))).not.toThrow();
	});
});

describe('hasCapability', () => {
	it('is false without a session, whatever the capability', () => {
		expect(hasCapability('os.access', locals(null))).toBe(false);
	});

	it('mirrors the capability decision for a real user', () => {
		expect(hasCapability('admin.apps', locals([ROLE_GROUPS.admin]))).toBe(true);
		expect(hasCapability('admin.apps', locals([ROLE_GROUPS.steward]))).toBe(false);
	});
});

describe('currentRole / currentStatus', () => {
	it('resolves the highest role held', () => {
		expect(currentRole(locals([]))).toBe('trial');
		expect(currentRole(locals([ROLE_GROUPS.member]))).toBe('member');
		expect(currentRole(locals([ROLE_GROUPS.member, ROLE_GROUPS.admin]))).toBe('admin');
	});

	it('reports trial for an anonymous caller without throwing', () => {
		expect(currentRole(locals(null))).toBe('trial');
	});

	it('reports the membership status', () => {
		expect(currentStatus(locals([], { membershipStatus: 'standby' }))).toBe('standby');
		expect(currentStatus(locals([]))).toBe('active');
	});
});
