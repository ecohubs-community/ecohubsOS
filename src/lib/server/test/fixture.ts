/**
 * In-memory database fixture for the DB-bound membership modules.
 *
 * Those modules were the least tested part of the branch and, not
 * coincidentally, where every defect found in review lived — they only fail on
 * paths that need real rows to exercise. This makes those paths reachable
 * without a dev database or network.
 *
 * Usage: mock `$lib/server/db` with `createTestDb()` *before* importing the
 * module under test, since it captures `db` at module scope.
 *
 *     const { db } = createTestDb();
 *     vi.mock('$lib/server/db', () => ({ db }));
 *     const { executeExit } = await import('$lib/server/membership-exit');
 *
 * The DDL below is written by hand rather than generated. `drizzle/` only
 * covers two tables — the rest of this schema was created with `db:push` — so
 * there is no migration history to replay. {@link fixtureTableDrift} guards the
 * DDL against its own table list; keeping it in step with `schema.ts` is
 * manual, and a missing column shows up as a failing test rather than silently.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '$lib/server/db/schema';

/**
 * Tables the fixture creates. Kept in one list so the coverage guard and the
 * DDL cannot disagree.
 */
export const FIXTURE_TABLES = [
	'user',
	'session',
	'applications',
	'proposals',
	'proposal_votes',
	'membership_events',
	'membership_reviews',
	'membership_warnings',
	'membership_cases',
	'member_emails',
	'reward_grants'
] as const;

const DDL = `
CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  authentik_id TEXT UNIQUE,
  groups TEXT,
  roles TEXT,
  wallet_address TEXT UNIQUE,
  wallet_connected_at INTEGER,
  safe_proposal_tx_hash TEXT,
  safe_owner_status TEXT,
  safe_role TEXT DEFAULT 'owner',
  safe_role_status TEXT,
  -- UNIQUE mirrors the production schema and 0003_offcoin_link_integrity.sql.
  -- Without it a fixture-backed test can link one Puckstack member to two
  -- accounts and pass, which is the exact failure the constraint exists to stop.
  puckstack_user_id TEXT UNIQUE,
  puckstack_invite_token TEXT,
  display_name TEXT,
  avatar TEXT,
  bio TEXT,
  languages TEXT,
  location TEXT,
  contribution TEXT,
  show_on_website INTEGER DEFAULT 1,
  onboarding_progress TEXT,
  contribution_progress TEXT,
  onboarding_started_at INTEGER,
  onboarding_completed_at INTEGER,
  intro_watched_at INTEGER,
  meeting_scheduling_url TEXT,
  membership_status TEXT NOT NULL DEFAULT 'active',
  membership_status_since INTEGER,
  standby_reason TEXT,
  exit_reason TEXT,
  last_participation_at INTEGER,
  last_participation_source TEXT,
  puckstack_activity_synced_at INTEGER,
  offcoin_member_id TEXT,
  offcoin_xp INTEGER,
  offcoin_eco INTEGER,
  offcoin_level INTEGER,
  offcoin_synced_at INTEGER
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL DEFAULT 'membership',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  form_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  snapshot_proposal_id TEXT,
  snapshot_proposal_link TEXT,
  ai_recommendation TEXT,
  confirmation_email_sent_at TEXT,
  rejection_email_sent_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  cancelled_by TEXT
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  choice_set_key TEXT NOT NULL,
  choices TEXT NOT NULL,
  threshold TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  vote_opens_at INTEGER NOT NULL,
  vote_closes_at INTEGER NOT NULL,
  ratification_ends_at INTEGER,
  status TEXT NOT NULL DEFAULT 'deliberating',
  result TEXT,
  discord_notified_transitions TEXT NOT NULL DEFAULT '[]',
  linked_application_id TEXT UNIQUE,
  linked_blog_draft_id TEXT UNIQUE
);

CREATE TABLE proposal_votes (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  choice TEXT NOT NULL,
  reason TEXT,
  voted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX proposal_votes_proposal_user_unique
  ON proposal_votes (proposal_id, user_id);

CREATE TABLE membership_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  from_role TEXT,
  to_role TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE membership_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  days_elapsed INTEGER NOT NULL,
  threshold_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX membership_reviews_pending_unique
  ON membership_reviews (user_id) WHERE status = 'pending';

CREATE TABLE membership_warnings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  cycle_anchor INTEGER NOT NULL,
  kind TEXT NOT NULL,
  drafted INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX membership_warnings_cycle_unique
  ON membership_warnings (user_id, days_before, cycle_anchor);

CREATE TABLE membership_cases (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  opened_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  public_summary TEXT NOT NULL,
  private_notes TEXT,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'voting',
  previous_status TEXT NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE member_emails (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  related_id TEXT,
  sent_at INTEGER,
  sent_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  dismissed_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX member_emails_dedupe
  ON member_emails (user_id, kind, related_id) WHERE related_id IS NOT NULL;

CREATE TABLE reward_grants (
  id TEXT PRIMARY KEY NOT NULL,
  recipient_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  eco INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  reason TEXT NOT NULL,
  offcoin_eco_tx_id TEXT,
  offcoin_xp_tx_id TEXT,
  announced_at INTEGER,
  created_at INTEGER NOT NULL
);
`;

export type TestDb = ReturnType<typeof createTestDb>['db'];

/** A fresh in-memory database with the membership schema applied. */
export function createTestDb() {
	const client = new Database(':memory:');
	client.pragma('foreign_keys = ON');
	client.exec(DDL);
	return { db: drizzle(client, { schema }), client };
}

let seq = 0;

/**
 * Insert a member. Defaults are an ordinary active member with an Offcoin
 * link, since that is the starting point for most of what is under test.
 */
export async function seedUser(
	db: TestDb,
	over: Partial<typeof schema.user.$inferInsert> = {}
): Promise<typeof schema.user.$inferSelect> {
	seq++;
	const now = new Date();
	const [row] = await db
		.insert(schema.user)
		.values({
			id: over.id ?? `u${seq}`,
			name: over.name ?? `Member ${seq}`,
			email: over.email ?? `member${seq}@example.com`,
			createdAt: now,
			updatedAt: now,
			groups: JSON.stringify(['EcoHubs Member']),
			puckstackUserId: `ps${seq}`,
			membershipStatus: 'active',
			...over
		})
		.returning();
	return row;
}

/**
 * Tables the fixture's DDL actually created.
 *
 * The fixture deliberately covers only the membership subset — onboarding,
 * feedback, blog and auth-provider tables are irrelevant to what it tests and
 * carrying them would mean maintaining the whole schema twice.
 *
 * So the guard is narrower than "matches schema.ts": it checks the DDL and
 * {@link FIXTURE_TABLES} agree with each other. That is the drift that actually
 * bites — a table added to one and not the other, surfacing later as a
 * confusing "no such table" inside an unrelated test.
 */
export function fixtureTableDrift(): { missing: string[]; unlisted: string[] } {
	const { client } = createTestDb();
	const rows = client
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
		.all() as { name: string }[];
	client.close();

	const created = new Set(rows.map((r) => r.name));
	const listed = new Set<string>(FIXTURE_TABLES);

	return {
		missing: [...listed].filter((t) => !created.has(t)),
		unlisted: [...created].filter((t) => !listed.has(t))
	};
}

/**
 * Run `fn` with inserts into one table failing, then restore it.
 *
 * A legitimate way to force a mid-operation database failure, which is
 * otherwise hard to provoke: it lets a test reach the rollback branch of
 * something that has already done real work — created a proposal, called an
 * external system — and check the compensation actually happens.
 *
 * A trigger rather than a dropped table, because operations usually read the
 * table before writing to it. Dropping it would fail the earlier read and the
 * test would never reach the branch it meant to exercise.
 */
export async function withFailingInserts(
	client: Database.Database,
	table: string,
	fn: () => Promise<void>
): Promise<void> {
	const trigger = `fixture_fail_insert_${table}`;
	client.exec(
		`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} ` +
			`BEGIN SELECT RAISE(ABORT, 'fixture: insert failed'); END`
	);
	try {
		await fn();
	} finally {
		client.exec(`DROP TRIGGER ${trigger}`);
	}
}
