/**
 * The public roster: who is on it, and what it shows when Offcoin is down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedUser } from '$lib/server/test/fixture';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$env/dynamic/private', () => ({ env: { MEMBERS_API_KEY: 'key' } }));

const members = vi.hoisted(() => ({ get: vi.fn(), getXp: vi.fn(), getBalance: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	withMemberAlias: (id: string, op: (alias: string) => unknown) => op(`puckstack:ws:${id}`)
}));

const { GET } = await import('./+server');

async function roster() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const res = await (GET as any)({
		request: new Request('http://os.test', { headers: { 'x-api-key': 'key' } })
	});
	return (await res.json()).members as { displayName: string; eco: number; level: number }[];
}

beforeEach(() => {
	vi.clearAllMocks();
	members.get.mockResolvedValue({ name: '' });
	members.getXp.mockResolvedValue({ xp: 150, level: 1 });
	members.getBalance.mockResolvedValue({ balance: 40 });
});

describe('GET /api/public/members', () => {
	it('lists members who started onboarding, and leaves out trial and not-started', async () => {
		const started = new Date();
		await seedUser(db, { displayName: 'Listed', onboardingStartedAt: started });
		await seedUser(db, { displayName: 'Trial', onboardingStartedAt: started, groups: '[]' });
		await seedUser(db, { displayName: 'Never started', onboardingStartedAt: null });

		const names = (await roster()).map((m) => m.displayName);

		expect(names).toContain('Listed');
		expect(names).not.toContain('Trial');
		expect(names).not.toContain('Never started');
	});

	it('falls back to the stored ECO when Offcoin is unreachable, not to 0', async () => {
		await seedUser(db, {
			displayName: 'Offline',
			onboardingStartedAt: new Date(),
			offcoinEco: 75,
			offcoinLevel: 2
		});
		members.get.mockRejectedValue(new Error('offcoin down'));

		const row = (await roster()).find((m) => m.displayName === 'Offline');

		expect(row).toMatchObject({ eco: 75, level: 2 });
	});
});
