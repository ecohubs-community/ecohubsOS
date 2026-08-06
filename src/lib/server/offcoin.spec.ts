import { describe, it, expect, beforeEach, vi } from 'vitest';

// `$env/dynamic/private` is resolved by SvelteKit at build time; stub it so the
// alias helper can be exercised against both configurations.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { memberAlias } = await import('./offcoin');

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
