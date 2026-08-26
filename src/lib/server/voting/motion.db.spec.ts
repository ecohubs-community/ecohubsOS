/**
 * The motion column against a real database.
 *
 * `motion.spec.ts` covers the normalisation rules in isolation; this checks the
 * half that only a table can answer — that "no motion" reaches SQLite as NULL
 * rather than an empty string, and that a motion survives the round trip with
 * the Markdown whitespace it was written with.
 */
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { normaliseMotion } from './motion';

const { db, client } = createTestDb();

function create(motion: unknown) {
	const [row] = db
		.insert(schema.proposals)
		.values({
			type: 'operational',
			title: 'A proposal',
			body: 'What this is about.',
			motion: normaliseMotion(motion),
			choiceSetKey: 'default',
			choices: '["Yes","No","Abstain"]',
			threshold: 'majority',
			voteOpensAt: new Date(),
			voteClosesAt: new Date(Date.now() + 86_400_000)
		})
		.returning()
		.all();
	return row;
}

/** Read past Drizzle, so an empty string can't hide behind a falsy mapping. */
function rawMotion(id: string): string | null {
	const row = client.prepare('SELECT motion FROM proposals WHERE id = ?').get(id) as {
		motion: string | null;
	};
	return row.motion;
}

describe('proposals.motion', () => {
	it('round-trips a motion verbatim, indentation included', () => {
		const motion = '1. We resolve **that**:\n   - the first sub-clause\n   - the second\n';
		const row = create(motion);
		expect(row.motion).toBe(motion);
		expect(rawMotion(row.id)).toBe(motion);
	});

	it('stores an omitted motion as SQL NULL', () => {
		const row = create(undefined);
		expect(row.motion).toBeNull();
		expect(rawMotion(row.id)).toBeNull();
	});

	it('stores a whitespace-only motion as SQL NULL, not an empty string', () => {
		const row = create('   \n\t ');
		expect(rawMotion(row.id)).toBeNull();
	});

	it('finds proposals that carry a motion, and skips those that do not', () => {
		const withMotion = create('We resolve that…');
		create('');
		const rows = db
			.select({ id: schema.proposals.id })
			.from(schema.proposals)
			.where(eq(schema.proposals.motion, 'We resolve that…'))
			.all();
		expect(rows.map((r) => r.id)).toEqual([withMotion.id]);
	});
});
