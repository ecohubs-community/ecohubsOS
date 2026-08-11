import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	checkRateLimit,
	getRemainingRequests,
	AUTH_RATE_LIMIT,
	API_RATE_LIMIT,
	STRICT_RATE_LIMIT,
	type RateLimitConfig
} from './rateLimit';

// Test config with short window for faster tests
const TEST_CONFIG: RateLimitConfig = {
	name: 'test',
	windowMs: 1000, // 1 second
	maxRequests: 3
};

describe('checkRateLimit', () => {
	beforeEach(() => {
		// Reset time mocking between tests
		vi.useRealTimers();
	});

	it('allows requests under the limit', () => {
		const config: RateLimitConfig = { name: 'under-limit', windowMs: 60000, maxRequests: 5 };

		expect(checkRateLimit(config, 'user1')).toBe(true);
		expect(checkRateLimit(config, 'user1')).toBe(true);
		expect(checkRateLimit(config, 'user1')).toBe(true);
	});

	it('blocks requests over the limit', () => {
		const config: RateLimitConfig = { name: 'over-limit', windowMs: 60000, maxRequests: 2 };

		expect(checkRateLimit(config, 'user2')).toBe(true); // 1st
		expect(checkRateLimit(config, 'user2')).toBe(true); // 2nd
		expect(checkRateLimit(config, 'user2')).toBe(false); // 3rd - blocked
		expect(checkRateLimit(config, 'user2')).toBe(false); // still blocked
	});

	it('tracks limits per identifier separately', () => {
		const config: RateLimitConfig = { name: 'per-id', windowMs: 60000, maxRequests: 2 };

		// User A uses their limit
		expect(checkRateLimit(config, 'userA')).toBe(true);
		expect(checkRateLimit(config, 'userA')).toBe(true);
		expect(checkRateLimit(config, 'userA')).toBe(false);

		// User B should still have full limit
		expect(checkRateLimit(config, 'userB')).toBe(true);
		expect(checkRateLimit(config, 'userB')).toBe(true);
		expect(checkRateLimit(config, 'userB')).toBe(false);
	});

	it('resets after window expires', () => {
		vi.useFakeTimers();
		const config: RateLimitConfig = { name: 'window-reset', windowMs: 1000, maxRequests: 2 };

		// Use up the limit
		expect(checkRateLimit(config, 'user3')).toBe(true);
		expect(checkRateLimit(config, 'user3')).toBe(true);
		expect(checkRateLimit(config, 'user3')).toBe(false);

		// Advance time past the window
		vi.advanceTimersByTime(1001);

		// Should be allowed again
		expect(checkRateLimit(config, 'user3')).toBe(true);
	});

	it('uses separate maps for different rate limiter names', () => {
		const configA: RateLimitConfig = { name: 'limiterA', windowMs: 60000, maxRequests: 1 };
		const configB: RateLimitConfig = { name: 'limiterB', windowMs: 60000, maxRequests: 1 };

		// Use up limit on limiter A
		expect(checkRateLimit(configA, 'shared-user')).toBe(true);
		expect(checkRateLimit(configA, 'shared-user')).toBe(false);

		// Limiter B should still allow the same user
		expect(checkRateLimit(configB, 'shared-user')).toBe(true);
	});
});

describe('getRemainingRequests', () => {
	it('returns max requests for new identifier', () => {
		const config: RateLimitConfig = { name: 'remaining-new', windowMs: 60000, maxRequests: 5 };
		expect(getRemainingRequests(config, 'new-user')).toBe(5);
	});

	it('returns correct remaining count after requests', () => {
		const config: RateLimitConfig = { name: 'remaining-used', windowMs: 60000, maxRequests: 5 };

		checkRateLimit(config, 'counting-user');
		expect(getRemainingRequests(config, 'counting-user')).toBe(4);

		checkRateLimit(config, 'counting-user');
		expect(getRemainingRequests(config, 'counting-user')).toBe(3);
	});

	it('returns 0 when limit is exhausted', () => {
		const config: RateLimitConfig = { name: 'remaining-zero', windowMs: 60000, maxRequests: 2 };

		checkRateLimit(config, 'exhausted-user');
		checkRateLimit(config, 'exhausted-user');
		checkRateLimit(config, 'exhausted-user'); // blocked

		expect(getRemainingRequests(config, 'exhausted-user')).toBe(0);
	});

	it('returns max requests after window expires', () => {
		vi.useFakeTimers();
		const config: RateLimitConfig = { name: 'remaining-expired', windowMs: 1000, maxRequests: 3 };

		checkRateLimit(config, 'expiring-user');
		checkRateLimit(config, 'expiring-user');
		expect(getRemainingRequests(config, 'expiring-user')).toBe(1);

		vi.advanceTimersByTime(1001);

		expect(getRemainingRequests(config, 'expiring-user')).toBe(3);
		vi.useRealTimers();
	});
});

describe('predefined rate limit configs', () => {
	it('AUTH_RATE_LIMIT has expected values', () => {
		expect(AUTH_RATE_LIMIT.name).toBe('auth');
		expect(AUTH_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000); // 15 minutes
		expect(AUTH_RATE_LIMIT.maxRequests).toBe(30);
	});

	it('API_RATE_LIMIT has expected values', () => {
		expect(API_RATE_LIMIT.name).toBe('api');
		expect(API_RATE_LIMIT.windowMs).toBe(60 * 1000); // 1 minute
		expect(API_RATE_LIMIT.maxRequests).toBe(60);
	});

	it('STRICT_RATE_LIMIT has expected values', () => {
		expect(STRICT_RATE_LIMIT.name).toBe('strict');
		expect(STRICT_RATE_LIMIT.windowMs).toBe(60 * 60 * 1000); // 1 hour
		expect(STRICT_RATE_LIMIT.maxRequests).toBe(5);
	});
});
