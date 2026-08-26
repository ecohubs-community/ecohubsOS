import { describe, it, expect } from 'vitest';
import { normaliseMotion, MOTION_MAX } from './motion';

function thrown(fn: () => unknown): { status: number; message: string } {
	try {
		fn();
	} catch (err) {
		const e = err as { status: number; body?: { message?: string } };
		return { status: e.status, message: e.body?.message ?? '' };
	}
	throw new Error('expected a throw');
}

describe('normaliseMotion', () => {
	it('treats an absent motion as no motion', () => {
		expect(normaliseMotion(undefined)).toBeNull();
		expect(normaliseMotion(null)).toBeNull();
	});

	it('collapses empty and whitespace-only to null, not an empty string', () => {
		// Otherwise the detail view renders a Motion heading over nothing.
		expect(normaliseMotion('')).toBeNull();
		expect(normaliseMotion('   ')).toBeNull();
		expect(normaliseMotion('\n\n\t ')).toBeNull();
	});

	it('keeps the text verbatim, including indentation Markdown gives meaning to', () => {
		const motion = '  1. We resolve that…\n     - with this sub-clause\n';
		expect(normaliseMotion(motion)).toBe(motion);
	});

	it('400s a non-string motion', () => {
		expect(thrown(() => normaliseMotion(42)).status).toBe(400);
		expect(thrown(() => normaliseMotion({ text: 'hi' })).status).toBe(400);
	});

	it('400s a motion over the cap, and accepts one exactly at it', () => {
		expect(normaliseMotion('x'.repeat(MOTION_MAX))).toHaveLength(MOTION_MAX);
		const err = thrown(() => normaliseMotion('x'.repeat(MOTION_MAX + 1)));
		expect(err.status).toBe(400);
		expect(err.message).toContain(String(MOTION_MAX));
	});
});
