import { describe, it, expect } from 'vitest';
import {
	isValidEmail,
	isValidPassword,
	isValidUsername,
	isValidLength,
	sanitizeString,
	MAX_LENGTHS
} from './validation';

describe('isValidEmail', () => {
	it('accepts valid standard emails', () => {
		expect(isValidEmail('user@example.com')).toBe(true);
		expect(isValidEmail('test.user@domain.org')).toBe(true);
		expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
		expect(isValidEmail('name123@test-domain.com')).toBe(true);
	});

	it('rejects invalid email formats', () => {
		expect(isValidEmail('invalid')).toBe(false);
		expect(isValidEmail('missing@')).toBe(false);
		expect(isValidEmail('@nodomain.com')).toBe(false);
		expect(isValidEmail('spaces in@email.com')).toBe(false);
		expect(isValidEmail('double@@at.com')).toBe(false);
	});

	it('handles edge cases', () => {
		expect(isValidEmail('')).toBe(false);
		expect(isValidEmail(null as unknown as string)).toBe(false);
		expect(isValidEmail(undefined as unknown as string)).toBe(false);
		expect(isValidEmail('a'.repeat(300) + '@example.com')).toBe(false); // too long
	});
});

describe('isValidPassword', () => {
	it('accepts valid complex passwords', () => {
		expect(isValidPassword('Password1').valid).toBe(true);
		expect(isValidPassword('MySecure123').valid).toBe(true);
		expect(isValidPassword('Test1234!@#').valid).toBe(true);
	});

	it('rejects passwords that are too short', () => {
		const result = isValidPassword('Pass1');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('8 characters');
	});

	it('rejects passwords without uppercase', () => {
		const result = isValidPassword('password123');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('uppercase');
	});

	it('rejects passwords without lowercase', () => {
		const result = isValidPassword('PASSWORD123');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('lowercase');
	});

	it('rejects passwords without numbers', () => {
		const result = isValidPassword('PasswordOnly');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('number');
	});

	it('handles edge cases', () => {
		expect(isValidPassword('').valid).toBe(false);
		expect(isValidPassword(null as unknown as string).valid).toBe(false);
		expect(isValidPassword(undefined as unknown as string).valid).toBe(false);
	});

	it('rejects passwords that are too long', () => {
		const longPassword = 'A1' + 'a'.repeat(MAX_LENGTHS.password);
		const result = isValidPassword(longPassword);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('less than');
	});
});

describe('isValidUsername', () => {
	it('accepts valid usernames', () => {
		expect(isValidUsername('john_doe').valid).toBe(true);
		expect(isValidUsername('user123').valid).toBe(true);
		expect(isValidUsername('test-user').valid).toBe(true);
		expect(isValidUsername('ABC').valid).toBe(true);
	});

	it('rejects usernames that are too short', () => {
		const result = isValidUsername('ab');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('3 characters');
	});

	it('rejects usernames that are too long', () => {
		const result = isValidUsername('a'.repeat(51));
		expect(result.valid).toBe(false);
		expect(result.error).toContain('less than');
	});

	it('rejects usernames with invalid characters', () => {
		const result = isValidUsername('user@name');
		expect(result.valid).toBe(false);
		expect(result.error).toContain('letters, numbers');
	});

	it('handles edge cases', () => {
		expect(isValidUsername('').valid).toBe(false);
		expect(isValidUsername(null as unknown as string).valid).toBe(false);
		expect(isValidUsername('   ').valid).toBe(false); // whitespace only
	});
});

describe('isValidLength', () => {
	it('accepts strings within bounds', () => {
		expect(isValidLength('hello', 1, 10).valid).toBe(true);
		expect(isValidLength('abc', 3, 3).valid).toBe(true);
	});

	it('rejects strings that are too short', () => {
		const result = isValidLength('hi', 5, 10);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('at least 5');
	});

	it('rejects strings that are too long', () => {
		const result = isValidLength('this is too long', 1, 5);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('less than 5');
	});

	it('trims whitespace before checking', () => {
		expect(isValidLength('  abc  ', 3, 5).valid).toBe(true);
		expect(isValidLength('  ab  ', 3, 5).valid).toBe(false);
	});

	it('handles edge cases', () => {
		expect(isValidLength('', 1, 10).valid).toBe(false);
		expect(isValidLength(null as unknown as string, 1, 10).valid).toBe(false);
	});
});

describe('sanitizeString', () => {
	it('trims whitespace', () => {
		expect(sanitizeString('  hello  ', 100)).toBe('hello');
		expect(sanitizeString('\t\ntest\n\t', 100)).toBe('test');
	});

	it('truncates to max length', () => {
		expect(sanitizeString('hello world', 5)).toBe('hello');
		expect(sanitizeString('abc', 10)).toBe('abc');
	});

	it('handles edge cases', () => {
		expect(sanitizeString('', 10)).toBe('');
		expect(sanitizeString(null as unknown as string, 10)).toBe('');
		expect(sanitizeString(undefined as unknown as string, 10)).toBe('');
	});
});

describe('MAX_LENGTHS', () => {
	it('has expected constants defined', () => {
		expect(MAX_LENGTHS.email).toBe(254);
		expect(MAX_LENGTHS.name).toBe(200);
		expect(MAX_LENGTHS.username).toBe(50);
		expect(MAX_LENGTHS.password).toBe(128);
		expect(MAX_LENGTHS.text).toBe(10000);
	});
});
