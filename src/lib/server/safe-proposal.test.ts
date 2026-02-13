import { describe, expect, it, vi } from 'vitest';

const getSafeDelegates = vi.fn();
const addSafeDelegate = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		SAFE_ADDRESS: '0x0000000000000000000000000000000000000001',
		SAFE_CHAIN_ID: '1',
		SAFE_API_KEY_1: 'key',
		SAFE_RPC_URL: 'http://localhost:8545',
		SAFE_DELEGATOR_PRIVATE_KEY: '0x0123456789012345678901234567890123456789012345678901234567890123'
	}
}));

vi.mock('@safe-global/api-kit', () => ({
	default: class SafeApiKit {
		getSafeDelegates = getSafeDelegates;
		addSafeDelegate = addSafeDelegate;
		constructor() {}
	}
}));

vi.mock('@safe-global/protocol-kit', () => ({
	default: { init: vi.fn() }
}));

describe('safe-proposal delegate helpers', () => {
	it('isSafeDelegate returns true when delegate exists', async () => {
		getSafeDelegates.mockResolvedValueOnce({ count: 1 });
		const { isSafeDelegate } = await import('./safe-proposal');
		await expect(isSafeDelegate('0x0000000000000000000000000000000000000002')).resolves.toBe(true);
	});

	it('addSafeDelegate calls SafeApiKit.addSafeDelegate when missing', async () => {
		getSafeDelegates.mockResolvedValueOnce({ count: 0 });
		addSafeDelegate.mockResolvedValueOnce({});

		const { addSafeDelegate: addDelegate } = await import('./safe-proposal');
		const result = await addDelegate('0x0000000000000000000000000000000000000002', 'Label');

		expect(result.success).toBe(true);
		expect(addSafeDelegate).toHaveBeenCalledTimes(1);
		expect(addSafeDelegate.mock.calls[0][0]).toMatchObject({
			safeAddress: '0x0000000000000000000000000000000000000001',
			delegateAddress: '0x0000000000000000000000000000000000000002',
			label: 'Label'
		});
	});
});

