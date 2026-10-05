/**
 * The progress endpoint takes the browser's word for most steps, but not for
 * server-verified ones: claiming `discord-connect` here used to be enough to
 * skip Discord entirely.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestDb, seedUser } from '$lib/server/test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$lib/server/participation', () => ({ recordParticipation: vi.fn() }));

const { PATCH } = await import('./+server');

async function patch(userId: string, body: unknown) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await (PATCH as any)({
		request: new Request('http://os.test', { method: 'PATCH', body: JSON.stringify(body) }),
		locals: { user: { id: userId } }
	});
	const [row] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
	return JSON.parse(row.onboardingProgress ?? '{}');
}

describe('PATCH /api/onboarding/progress', () => {
	it('ignores a client claim that Discord is connected', async () => {
		const u = await seedUser(db);

		const progress = await patch(u.id, {
			completedSteps: { 'discord-connect': 'now', 'manifesto-sign': 'now' }
		});

		expect(progress['manifesto-sign']).toBe('now');
		expect(progress['discord-connect']).toBeUndefined();
	});

	it('keeps a server-verified step through a reset', async () => {
		const u = await seedUser(db, {
			onboardingProgress: JSON.stringify({ 'discord-connect': 'verified', 'profile-setup': 'x' })
		});

		const progress = await patch(u.id, { completedSteps: {}, reset: true });

		expect(progress).toEqual({ 'discord-connect': 'verified' });
	});
});
