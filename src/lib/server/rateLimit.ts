/**
 * Simple in-memory rate limiting for API endpoints
 * Note: For distributed deployments, consider using Redis or @upstash/ratelimit
 */

interface RateLimitEntry {
	count: number;
	resetTime: number;
}

const rateLimitMaps = new Map<string, Map<string, RateLimitEntry>>();

export interface RateLimitConfig {
	/** Unique identifier for this rate limiter (e.g., 'auth', 'applications') */
	name: string;
	/** Time window in milliseconds */
	windowMs: number;
	/** Maximum requests per window */
	maxRequests: number;
}

/**
 * Check if a request should be rate limited
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(config: RateLimitConfig, identifier: string): boolean {
	const { name, windowMs, maxRequests } = config;

	// Get or create map for this rate limiter
	if (!rateLimitMaps.has(name)) {
		rateLimitMaps.set(name, new Map());
	}
	const map = rateLimitMaps.get(name)!;

	const now = Date.now();
	const entry = map.get(identifier);

	// No entry or window expired - allow and start fresh
	if (!entry || now > entry.resetTime) {
		map.set(identifier, {
			count: 1,
			resetTime: now + windowMs
		});
		return true;
	}

	// Check if limit exceeded
	if (entry.count >= maxRequests) {
		return false;
	}

	// Increment count and allow
	entry.count++;
	return true;
}

/**
 * Get remaining requests for an identifier
 */
export function getRemainingRequests(config: RateLimitConfig, identifier: string): number {
	const map = rateLimitMaps.get(config.name);
	if (!map) return config.maxRequests;

	const entry = map.get(identifier);
	if (!entry || Date.now() > entry.resetTime) return config.maxRequests;

	return Math.max(0, config.maxRequests - entry.count);
}

// Predefined rate limit configs
export const AUTH_RATE_LIMIT: RateLimitConfig = {
	name: 'auth',
	windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 10 // 10 auth attempts per 15 minutes
};

export const API_RATE_LIMIT: RateLimitConfig = {
	name: 'api',
	windowMs: 60 * 1000, // 1 minute
	maxRequests: 60 // 60 requests per minute
};

export const STRICT_RATE_LIMIT: RateLimitConfig = {
	name: 'strict',
	windowMs: 60 * 60 * 1000, // 1 hour
	maxRequests: 5 // 5 requests per hour
};
