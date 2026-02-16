import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = { SAFE_ONBOARDING_ROLE: 'owner', SAFE_ADDRESS: '0x0000000000000000000000000000000000000001' };

const isSafeOwner = vi.fn();
const isSafeDelegate = vi.fn();
const checkProposalStatus = vi.fn();
const getSafeAddress = vi.fn(() => env.SAFE_ADDRESS);

const where = vi.fn();
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));

vi.mock('$lib/server/safe-proposal', () => ({
	isSafeOwner,
	isSafeDelegate,
	checkProposalStatus,
	getSafeAddress
}));

vi.mock('$lib/server/db', () => ({
	db: { update }
}));

vi.mock('$lib/server/db/schema', () => ({
	user: {}
}));

vi.mock('$env/dynamic/private', () => ({
	env
}));

describe('GET /api/safe/status', () => {
	beforeEach(() => {
		vi.resetModules();
		env.SAFE_ONBOARDING_ROLE = 'owner';
		isSafeOwner.mockReset();
		isSafeDelegate.mockReset();
		checkProposalStatus.mockReset();
		update.mockClear();
		set.mockClear();
		where.mockClear();
	});

	it('returns delegate_added when proposer delegate exists', async () => {
		env.SAFE_ONBOARDING_ROLE = 'proposer';

		isSafeOwner.mockResolvedValueOnce(false);
		isSafeDelegate.mockResolvedValueOnce(true);

		const { GET } = await import('./+server');
		const response = await GET({
			locals: { user: { id: 'u1', walletAddress: '0xW', safeOwnerStatus: null } }
		} as any);

		const body = await response.json();
		expect(body.status).toBe('delegate_added');
	});

	it('returns not_proposed when proposer delegate missing', async () => {
		env.SAFE_ONBOARDING_ROLE = 'proposer';

		isSafeOwner.mockResolvedValueOnce(false);
		isSafeDelegate.mockResolvedValueOnce(false);

		const { GET } = await import('./+server');
		const response = await GET({
			locals: { user: { id: 'u1', walletAddress: '0xW', safeOwnerStatus: null } }
		} as any);

		const body = await response.json();
		expect(body.status).toBe('not_proposed');
	});

	it('returns pending for owner onboarding with pending tx', async () => {
		env.SAFE_ONBOARDING_ROLE = 'owner';

		isSafeOwner.mockResolvedValueOnce(false);
		checkProposalStatus.mockResolvedValueOnce({
			status: 'pending',
			safeTxHash: '0xHASH',
			confirmations: 1,
			threshold: 2
		});

		const { GET } = await import('./+server');
		const response = await GET({
			locals: {
				user: { id: 'u1', walletAddress: '0xW', safeOwnerStatus: 'pending', safeProposalTxHash: '0xHASH' }
			}
		} as any);

		const body = await response.json();
		expect(body.status).toBe('pending');
		expect(body.safeTxHash).toBe('0xHASH');
	});
});
