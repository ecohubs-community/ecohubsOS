/**
 * The Puckstack link is established by Puckstack, not claimed by the caller.
 *
 * The id used to arrive in the request body with nothing proving it belonged to
 * the sender. It is visible in the workspace, so any member could name another's
 * and — while it was still unlinked — attach their own wallet to that person's
 * Offcoin member, then hold the link that decides where grants land and which
 * level the gates read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const members = vi.hoisted(() => ({ get: vi.fn(), getXp: vi.fn(), getBalance: vi.fn(), addAlias: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members }),
	memberAlias: (id: string) => `puckstack:ws:${id}`
}));

const snapshot = vi.hoisted(() => ({ saveOffcoinSnapshot: vi.fn(async () => true) }));
vi.mock('$lib/server/offcoin-snapshot', () => snapshot);
vi.mock('@offcoin/sdk', () => ({ NotFoundError: class extends Error {} }));

const identity = vi.hoisted(() => ({ resolvePuckstackIdentity: vi.fn() }));
vi.mock('$lib/server/puckstack-identity', () => identity);

const dbMock = vi.hoisted(() => ({
	query: {
		user: {
			findFirst: vi.fn(async (): Promise<{ id: string } | undefined> => undefined)
		}
	},
	update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) }))
}));
vi.mock('$lib/server/db', () => ({ db: dbMock }));

const { POST } = await import('./+server');

const WALLET = '0xabc';

const locals = (over: Record<string, unknown> = {}) => ({
	user: {
		id: 'me',
		email: 'me@example.com',
		walletAddress: WALLET,
		puckstackUserId: null,
		puckstackInviteToken: null,
		...over
	}
});

/** The body a caller controls — deliberately carrying a Puckstack id to ignore. */
const request = (body: Record<string, unknown> = {}) =>
	({ json: async () => ({ walletAddress: WALLET, ...body }) }) as unknown as Request;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (args: any) => (POST as any)(args);

beforeEach(() => {
	vi.clearAllMocks();
	members.get.mockResolvedValue({ id: 'oc-1', name: 'Me', aliases: [] });
	members.getXp.mockResolvedValue({ xp: 900, level: 5 });
	members.getBalance.mockResolvedValue({ balance: 10 });
	snapshot.saveOffcoinSnapshot.mockResolvedValue(true);
	dbMock.query.user.findFirst.mockResolvedValue(undefined);
	identity.resolvePuckstackIdentity.mockResolvedValue({
		kind: 'member',
		userId: 'ps-mine',
		workspaceUrl: 'https://puckstack.xyz/ecohubs'
	});
});

describe('resolving whose account to link', () => {
	it('ignores a Puckstack id in the body and uses the one Puckstack returns', async () => {
		// The attack: naming someone else's id and getting their economy.
		const res = await call({
			request: request({ puckstackUserId: 'ps-someone-else' }),
			locals: locals()
		});

		expect(identity.resolvePuckstackIdentity).toHaveBeenCalledWith('me@example.com', undefined);
		expect(members.get).toHaveBeenCalledWith('puckstack:ws:ps-mine');
		expect(await res.json()).toMatchObject({ puckstackUserId: 'ps-mine' });
	});

	it('resolves against the session email, not anything sent', async () => {
		await call({ request: request({ email: 'someone@else.com' }), locals: locals() });
		expect(identity.resolvePuckstackIdentity).toHaveBeenCalledWith('me@example.com', undefined);
	});

	it('trusts a stored id without a second round trip', async () => {
		// A stored id came from this same resolution, so it is already Puckstack's
		// answer rather than a claim.
		await call({ request: request(), locals: locals({ puckstackUserId: 'ps-stored' }) });

		expect(identity.resolvePuckstackIdentity).not.toHaveBeenCalled();
		expect(members.get).toHaveBeenCalledWith('puckstack:ws:ps-stored');
	});

	it('passes a stored invite token so invitations do not stack up', async () => {
		await call({ request: request(), locals: locals({ puckstackInviteToken: 'tok-1' }) });
		expect(identity.resolvePuckstackIdentity).toHaveBeenCalledWith('me@example.com', 'tok-1');
	});

	it('refuses when Puckstack has never seen the caller', async () => {
		identity.resolvePuckstackIdentity.mockResolvedValue({
			kind: 'invitation',
			token: 't',
			joinUrl: 'https://puckstack.xyz/join/t',
			expiresAt: '2026-01-01'
		});

		await expect(call({ request: request(), locals: locals() })).rejects.toMatchObject({
			status: 409
		});
		expect(members.addAlias).not.toHaveBeenCalled();
	});

	it('does not link when Puckstack cannot be reached', async () => {
		// Failing closed matters more than convenience here: linking the wrong
		// member is not something a later sync corrects.
		identity.resolvePuckstackIdentity.mockResolvedValue({
			kind: 'error',
			status: 502,
			message: 'Could not reach Puckstack'
		});

		await expect(call({ request: request(), locals: locals() })).rejects.toMatchObject({
			status: 502
		});
		expect(members.addAlias).not.toHaveBeenCalled();
	});
});

describe('the wallet still has to be the caller’s', () => {
	it('refuses a wallet that is not on the account', async () => {
		await expect(
			call({ request: request({ walletAddress: '0xdead' }), locals: locals() })
		).rejects.toMatchObject({ status: 403 });
	});
});

describe('a link already held elsewhere', () => {
	it('refuses rather than moving it', async () => {
		dbMock.query.user.findFirst.mockResolvedValue({ id: 'someone-else' });

		await expect(call({ request: request(), locals: locals() })).rejects.toMatchObject({
			status: 409
		});
		expect(members.addAlias).not.toHaveBeenCalled();
	});
});
