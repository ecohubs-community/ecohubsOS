import { describe, it, expect, beforeEach, vi } from 'vitest';

// `$env/dynamic/private` is resolved by SvelteKit at build time; stub it so the
// alias helper can be exercised against both configurations.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { memberAlias, memberAliases, parsePuckstackUserId, withMemberAlias } = await import(
	'./offcoin'
);
const { NotFoundError } = await import('@offcoin/sdk');

describe('memberAlias', () => {
	beforeEach(() => {
		delete env.PUCKSTACK_WORKSPACE_ID;
	});

	it('builds the workspace-scoped alias Puckstack writes', () => {
		env.PUCKSTACK_WORKSPACE_ID = 'ws-uuid';
		expect(memberAlias('user-123')).toBe('puckstack:ws-uuid:user-123');
	});

	it('falls back to the legacy unscoped alias when the workspace is unset', () => {
		// Not a failure: Puckstack still attaches the legacy alias to new members
		// during the transition, so an unconfigured deploy behaves as it did before.
		expect(memberAlias('user-123')).toBe('puckstack:user-123');
	});

	it('keeps the user id intact in both forms', () => {
		expect(memberAlias('abc-def')).toContain('abc-def');
		env.PUCKSTACK_WORKSPACE_ID = 'ws';
		expect(memberAlias('abc-def')).toContain('abc-def');
	});
});

describe('memberAliases', () => {
	beforeEach(() => {
		delete env.PUCKSTACK_WORKSPACE_ID;
	});

	it('offers the scoped alias first and the legacy one as a fallback', () => {
		env.PUCKSTACK_WORKSPACE_ID = 'ws-uuid';
		expect(memberAliases('user-123')).toEqual(['puckstack:ws-uuid:user-123', 'puckstack:user-123']);
	});

	it('does not repeat itself when there is no workspace to scope by', () => {
		expect(memberAliases('user-123')).toEqual(['puckstack:user-123']);
	});
});

describe('parsePuckstackUserId', () => {
	beforeEach(() => {
		delete env.PUCKSTACK_WORKSPACE_ID;
	});

	it('reads the id out of the legacy alias', () => {
		expect(parsePuckstackUserId('puckstack:user-123')).toBe('user-123');
	});

	it('reads the id out of our own scoped alias', () => {
		env.PUCKSTACK_WORKSPACE_ID = 'ws-uuid';
		expect(parsePuckstackUserId('puckstack:ws-uuid:user-123')).toBe('user-123');
	});

	it('refuses a scoped alias belonging to another workspace', () => {
		env.PUCKSTACK_WORKSPACE_ID = 'ws-uuid';
		expect(parsePuckstackUserId('puckstack:other-ws:user-123')).toBeNull();
	});

	it('refuses any scoped alias when no workspace is configured', () => {
		// We cannot tell ours from theirs, and guessing wrong hands one of our
		// accounts another workspace's economy.
		expect(parsePuckstackUserId('puckstack:ws-uuid:user-123')).toBeNull();
	});

	it('ignores aliases that are not ours', () => {
		expect(parsePuckstackUserId('discord:12345')).toBeNull();
		expect(parsePuckstackUserId('wallet:0xabc')).toBeNull();
		expect(parsePuckstackUserId('email:a@b.c')).toBeNull();
	});
});

describe('withMemberAlias', () => {
	beforeEach(() => {
		env.PUCKSTACK_WORKSPACE_ID = 'ws-uuid';
	});

	it('uses the scoped alias when it resolves, without trying the legacy one', async () => {
		const op = vi.fn().mockResolvedValue('ok');
		await expect(withMemberAlias('user-123', op)).resolves.toBe('ok');
		expect(op).toHaveBeenCalledTimes(1);
		expect(op).toHaveBeenCalledWith('puckstack:ws-uuid:user-123');
	});

	it('falls back to the legacy alias for members Puckstack never migrated', async () => {
		const op = vi
			.fn()
			.mockRejectedValueOnce(new NotFoundError('Member not found'))
			.mockResolvedValue('ok');
		await expect(withMemberAlias('user-123', op)).resolves.toBe('ok');
		expect(op).toHaveBeenNthCalledWith(2, 'puckstack:user-123');
	});

	it('reports not-found only once every alias has been tried', async () => {
		const op = vi.fn().mockRejectedValue(new NotFoundError('Member not found'));
		await expect(withMemberAlias('user-123', op)).rejects.toBeInstanceOf(NotFoundError);
		expect(op).toHaveBeenCalledTimes(2);
	});

	it('does not retry other failures — an outage says nothing about the alias', async () => {
		const op = vi.fn().mockRejectedValue(new Error('connection reset'));
		await expect(withMemberAlias('user-123', op)).rejects.toThrow('connection reset');
		expect(op).toHaveBeenCalledTimes(1);
	});
});
