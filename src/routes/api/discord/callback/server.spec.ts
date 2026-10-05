/**
 * The Discord callback is the only thing that may complete the Discord
 * onboarding step, and only when the Member role was actually granted.
 *
 * Before this, the browser marked the step done on any return (or on a
 * hand-typed `?discord=connected`), and role failures were only logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedUser } from '$lib/server/test/fixture';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';

const { db } = createTestDb();
vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$env/dynamic/private', () => ({
	env: { DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'secret' }
}));

const discord = vi.hoisted(() => ({ grantDiscordMemberRole: vi.fn() }));
vi.mock('$lib/server/discord', () => discord);

const offcoinMembers = vi.hoisted(() => ({ get: vi.fn(), addAlias: vi.fn() }));
vi.mock('$lib/server/offcoin', () => ({
	getOffcoinClient: () => ({ members: offcoinMembers }),
	withMemberAlias: (id: string, op: (alias: string) => unknown) => op(`puckstack:ws:${id}`)
}));

const { GET } = await import('./+server');
const { getOnboardingProgress } = await import('$lib/server/onboarding');

const NONCE = 'nonce-1';
const state = (nonce = NONCE, returnTo = '/onboarding') =>
	Buffer.from(JSON.stringify({ nonce, returnTo })).toString('base64url');

function request(
	userRow: { id: string; puckstackUserId: string | null },
	{ stateParam = state(), cookieNonce = NONCE, extra = '' } = {}
) {
	return {
		url: new URL(`http://os.test/api/discord/callback?code=abc&state=${stateParam}${extra}`),
		cookies: { get: () => cookieNonce || undefined, delete: vi.fn() },
		locals: { user: userRow }
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(args: any): Promise<{ status: number; location?: string }> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await (GET as any)(args);
		return { status: 200 };
	} catch (thrown) {
		const t = thrown as { status: number; location?: string };
		return { status: t.status, location: t.location };
	}
}

async function reload(id: string) {
	const [row] = await db.select().from(schema.user).where(eq(schema.user.id, id));
	return row;
}

beforeEach(() => {
	vi.clearAllMocks();
	offcoinMembers.get.mockResolvedValue({ aliases: [] });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url.endsWith('/oauth2/token')
				? new Response(JSON.stringify({ access_token: 'at' }))
				: new Response(JSON.stringify({ id: 'd-123', username: 'someone' }))
		)
	);
});
afterEach(() => vi.unstubAllGlobals());

describe('state check', () => {
	it('refuses a state whose nonce does not match the cookie', async () => {
		const u = await seedUser(db);
		const res = await call(request(u, { stateParam: state('forged') }));

		expect(res.status).toBe(400);
		expect(discord.grantDiscordMemberRole).not.toHaveBeenCalled();
	});

	it('refuses when the nonce cookie is missing', async () => {
		const u = await seedUser(db);
		const res = await call(request(u, { cookieNonce: '' }));

		expect(res.status).toBe(400);
	});

	it('sends a cancelled authorization back without granting anything', async () => {
		const u = await seedUser(db);
		const res = await call(request(u, { extra: '&error=access_denied' }));

		expect(res).toMatchObject({ status: 302, location: '/onboarding?discord=denied' });
		expect(discord.grantDiscordMemberRole).not.toHaveBeenCalled();
	});
});

describe('role granted', () => {
	it('stores the link, completes the step and says connected', async () => {
		discord.grantDiscordMemberRole.mockResolvedValue(true);
		const u = await seedUser(db);

		const res = await call(request(u));

		expect(res).toMatchObject({ status: 302, location: '/onboarding?discord=connected' });
		const after = await reload(u.id);
		expect(after.discordUserId).toBe('d-123');
		expect(after.discordConnectedAt).not.toBeNull();
		expect(JSON.parse(after.onboardingProgress!)['discord-connect']).toBeTruthy();
		expect(offcoinMembers.addAlias).toHaveBeenCalledWith(
			`puckstack:ws:${u.puckstackUserId}`,
			'discord:d-123'
		);
	});
});

describe('relinking', () => {
	it('refuses a second Discord account once the role was granted, before granting', async () => {
		const u = await seedUser(db, { discordUserId: 'd-old', discordConnectedAt: new Date() });

		const res = await call(request(u));

		expect(res).toMatchObject({ status: 302, location: '/onboarding?discord=already_linked' });
		expect(discord.grantDiscordMemberRole).not.toHaveBeenCalled();
		expect((await reload(u.id)).discordUserId).toBe('d-old');
	});

	it('lets a link whose role never landed be replaced', async () => {
		discord.grantDiscordMemberRole.mockResolvedValue(true);
		const u = await seedUser(db, { discordUserId: 'd-old', discordConnectedAt: null });

		const res = await call(request(u));

		expect(res.location).toBe('/onboarding?discord=connected');
		expect((await reload(u.id)).discordUserId).toBe('d-123');
	});

	it('lets the same Discord account retry', async () => {
		discord.grantDiscordMemberRole.mockResolvedValue(true);
		const u = await seedUser(db, { discordUserId: 'd-123', discordConnectedAt: new Date() });

		expect((await call(request(u))).location).toBe('/onboarding?discord=connected');
	});
});

describe('redirect', () => {
	it('keeps an existing query on returnTo intact', async () => {
		discord.grantDiscordMemberRole.mockResolvedValue(false);
		const u = await seedUser(db);

		const res = await call(request(u, { stateParam: state(NONCE, '/onboarding?tab=x#top') }));

		expect(res.location).toBe('/onboarding?tab=x&discord=failed#top');
	});
});

describe('role not granted', () => {
	it('keeps the id but leaves the step open, and says failed', async () => {
		discord.grantDiscordMemberRole.mockResolvedValue(false);
		const u = await seedUser(db);

		const res = await call(request(u));

		expect(res).toMatchObject({ status: 302, location: '/onboarding?discord=failed' });
		const after = await reload(u.id);
		expect(after.discordUserId).toBe('d-123');
		expect(after.discordConnectedAt).toBeNull();
		expect((await getOnboardingProgress(u.id))['discord-connect']).toBeUndefined();
	});

	it('says failed when Discord rejects the code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('bad', { status: 400 }))
		);
		const u = await seedUser(db);

		const res = await call(request(u));

		expect(res).toMatchObject({ status: 302, location: '/onboarding?discord=failed' });
		expect(discord.grantDiscordMemberRole).not.toHaveBeenCalled();
	});
});
