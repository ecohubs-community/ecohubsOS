/**
 * Input validation utilities for API endpoints
 */

// RFC 5322 compliant email regex (simplified but robust)
const EMAIL_REGEX =
	/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Maximum lengths for common fields
export const MAX_LENGTHS = {
	email: 254,
	name: 200,
	username: 50,
	password: 128,
	text: 10000
} as const;

/**
 * Validate email format (RFC 5322 compliant)
 */
export function isValidEmail(email: string): boolean {
	if (!email || typeof email !== 'string') return false;
	if (email.length > MAX_LENGTHS.email) return false;
	return EMAIL_REGEX.test(email);
}

/**
 * Validate password complexity
 * Requirements: min 8 chars, at least one uppercase, one lowercase, one number
 */
export function isValidPassword(password: string): { valid: boolean; error?: string } {
	if (!password || typeof password !== 'string') {
		return { valid: false, error: 'Password is required' };
	}

	if (password.length < 8) {
		return { valid: false, error: 'Password must be at least 8 characters' };
	}

	if (password.length > MAX_LENGTHS.password) {
		return { valid: false, error: `Password must be less than ${MAX_LENGTHS.password} characters` };
	}

	if (!/[a-z]/.test(password)) {
		return { valid: false, error: 'Password must contain at least one lowercase letter' };
	}

	if (!/[A-Z]/.test(password)) {
		return { valid: false, error: 'Password must contain at least one uppercase letter' };
	}

	if (!/\d/.test(password)) {
		return { valid: false, error: 'Password must contain at least one number' };
	}

	return { valid: true };
}

/**
 * Validate string length within bounds
 */
export function isValidLength(
	value: string,
	minLength: number,
	maxLength: number
): { valid: boolean; error?: string } {
	if (!value || typeof value !== 'string') {
		return { valid: false, error: 'Value is required' };
	}

	const trimmed = value.trim();

	if (trimmed.length < minLength) {
		return { valid: false, error: `Must be at least ${minLength} characters` };
	}

	if (trimmed.length > maxLength) {
		return { valid: false, error: `Must be less than ${maxLength} characters` };
	}

	return { valid: true };
}

/**
 * Validate username format
 * Requirements: 3-50 chars, alphanumeric with underscores/hyphens
 */
export function isValidUsername(username: string): { valid: boolean; error?: string } {
	if (!username || typeof username !== 'string') {
		return { valid: false, error: 'Username is required' };
	}

	const trimmed = username.trim();

	if (trimmed.length < 3) {
		return { valid: false, error: 'Username must be at least 3 characters' };
	}

	if (trimmed.length > MAX_LENGTHS.username) {
		return { valid: false, error: `Username must be less than ${MAX_LENGTHS.username} characters` };
	}

	if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
		return {
			valid: false,
			error: 'Username can only contain letters, numbers, underscores, and hyphens'
		};
	}

	return { valid: true };
}

/**
 * Sanitize string input (trim and limit length)
 */
export function sanitizeString(value: string, maxLength: number): string {
	if (!value || typeof value !== 'string') return '';
	return value.trim().slice(0, maxLength);
}
