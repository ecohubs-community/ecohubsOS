/**
 * The Offcoin member lookup is bound to the caller.
 *
 * `puckstackUserId` arrives as a query parameter and the snapshot write targets
 * `locals.user.id`, so without this guard a member could look up someone else
 * and cache *their* level onto their own account. `can()` reads that column,
 * which makes it privilege escalation rather than an untidy cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const members = vi.hoisted(() => ({ get: vi.fn(), getXp: vi.fn(), getBalance: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	memberAlias: (id: string) => `puckstack:ws:${id}`,
	withMemberAlias: (id: string, op: (alias: string) => unknown) => op(`puckstack:ws:${id}`)
}));

const snapshot = vi.hoisted(() => ({ saveOffcoinSnapshot: vi.fn(async () => true) }));
vi.mock('$lib/server/offcoin-snapshot', () => snapshot);
vi.mock('@offcoin/sdk', () => ({ NotFoundError: class extends Error {} }));

const { GET } = await import('./+server');

const locals = (over: Record<string, unknown> = {}) => ({
	user: { id: 'me', puckstackUserId: 'ps-me', ...over }
});
const req = (id: string) => ({
	url: new URL(`http://x/api/offcoin/member?puckstackUserId=${id}`)
});

beforeEach(() => {
	vi.clearAllMocks();
	members.get.mockResolvedValue({ id: 'oc-1', name: 'Me', aliases: [] });
	members.getXp.mockResolvedValue({ xp: 900, level: 5 });
	members.getBalance.mockResolvedValue({ balance: 10 });
	snapshot.saveOffcoinSnapshot.mockResolvedValue(true);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (args: any) => (GET as any)(args);

describe('cross-user lookups', () => {
	it('refuses another member id and writes no snapshot', async () => {
		// The escalation: a level-0 member asking about an admin, and the answer
		// landing on their own row.
		await expect(call({ ...req('ps-someone-else'), locals: locals() })).rejects.toMatchObject({
			status: 403
		});
		expect(snapshot.saveOffcoinSnapshot).not.toHaveBeenCalled();
		expect(members.getXp).not.toHaveBeenCalled();
	});

	it('refuses when the caller has no link of their own', async () => {
		await expect(
			call({ ...req('ps-anything'), locals: locals({ puckstackUserId: null }) })
		).rejects.toMatchObject({ status: 403 });
		expect(snapshot.saveOffcoinSnapshot).not.toHaveBeenCalled();
	});

	it('allows the caller their own member, and caches it against themselves', async () => {
		const res = await call({ ...req('ps-me'), locals: locals() });

		expect(res.status).toBe(200);
		expect(snapshot.saveOffcoinSnapshot).toHaveBeenCalledWith('me', {
			memberId: 'oc-1',
			xp: 900,
			level: 5
		});
	});
});
