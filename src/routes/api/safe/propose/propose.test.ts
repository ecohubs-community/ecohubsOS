import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = { SAFE_ONBOARDING_ROLE: 'owner', SAFE_ADDRESS: '0x0000000000000000000000000000000000000001' };

const isSafeOwner = vi.fn();
const isSafeDelegate = vi.fn();
const addSafeDelegate = vi.fn();
const proposeAddOwner = vi.fn();
const getSafeAddress = vi.fn(() => env.SAFE_ADDRESS);

const where = vi.fn();
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));

vi.mock('$lib/server/safe-proposal', () => ({
	isSafeOwner,
	isSafeDelegate,
	addSafeDelegate,
	proposeAddOwner,
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

describe('POST /api/safe/propose', () => {
	beforeEach(() => {
		vi.resetModules();
		env.SAFE_ONBOARDING_ROLE = 'owner';
		isSafeOwner.mockReset();
		isSafeDelegate.mockReset();
		addSafeDelegate.mockReset();
		proposeAddOwner.mockReset();
		update.mockClear();
		set.mockClear();
		where.mockClear();
	});

	it('registers proposer when SAFE_ONBOARDING_ROLE=proposer', async () => {
		env.SAFE_ONBOARDING_ROLE = 'proposer';

		isSafeOwner.mockResolvedValueOnce(false);
		isSafeDelegate.mockResolvedValueOnce(false);
		addSafeDelegate.mockResolvedValueOnce({ success: true });

		const { POST } = await import('./+server');
		const response = await POST({
			locals: { user: { id: 'u1', walletAddress: '0xW' } }
		} as any);

		const body = await response.json();
		expect(body.status).toBe('delegate_added');
		expect(addSafeDelegate).toHaveBeenCalledTimes(1);
	});

	it('proposes addOwner when SAFE_ONBOARDING_ROLE=owner', async () => {
		env.SAFE_ONBOARDING_ROLE = 'owner';

		isSafeOwner.mockResolvedValueOnce(false);
		proposeAddOwner.mockResolvedValueOnce({ success: true, safeTxHash: '0xHASH' });

		const { POST } = await import('./+server');
		const response = await POST({
			locals: { user: { id: 'u1', walletAddress: '0xW', safeOwnerStatus: null, safeProposalTxHash: null } }
		} as any);

		const body = await response.json();
		expect(body.status).toBe('pending');
		expect(body.safeTxHash).toBe('0xHASH');
		expect(proposeAddOwner).toHaveBeenCalledTimes(1);
	});
});
