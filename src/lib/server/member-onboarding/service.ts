import { db } from '$lib/server/db';
import {
	memberOnboarding,
	memberOnboardingEvents,
	memberOnboardingNotes,
	user as userTable,
	session as sessionTable,
	applications
} from '$lib/server/db/schema';
import { eq, inArray, desc, isNotNull } from 'drizzle-orm';
import { onboardingLogger } from '$lib/server/logger';

export const STAGES = [
	'accepted',
	'reminder',
	'logged_in',
	'buddy_call',
	'complete',
	'dormant'
] as const;
export type Stage = (typeof STAGES)[number];

/** Days after acceptance with no login before a member needs a manual reminder. */
export const REMINDER_AFTER_DAYS = 7;

type OnboardingRow = typeof memberOnboarding.$inferSelect;
type UserRow = typeof userTable.$inferSelect;

/**
 * Derive the kanban stage from the onboarding row + its linked user. Stage is
 * never stored — always computed — so the board cannot drift from reality.
 *
 * "Complete" requires BOTH onboarding finished AND the buddy-call step satisfied
 * — where satisfied means the call was actually held (logged) OR deliberately
 * skipped ("not needed"). Finishing onboarding alone keeps the member in
 * "Logged in" with the invite-to-buddy-call prompt.
 *
 * Priority high→low: complete > dormant > buddy_call > logged_in > reminder > accepted.
 * `dormant` is a manual "set aside — no response" override (parks the card out of
 * the active flow); a genuinely completed member still shows as complete.
 */
export function deriveStage(
	row: OnboardingRow,
	linkedUser: UserRow | null,
	now: Date = new Date()
): Stage {
	const buddyDone = !!(row.buddyCallAt || row.buddyCallSkippedAt);
	const buddyStarted = !!(row.buddyCallInvitedAt || row.buddyCallAt || row.buddyCallSkippedAt);
	const onboardingDone = !!linkedUser?.onboardingCompletedAt;

	if (onboardingDone && buddyDone) return 'complete';
	if (row.dormantAt) return 'dormant';
	if (buddyStarted) return 'buddy_call';
	// An account with the same email exists → the member has enrolled & logged in.
	if (linkedUser) return 'logged_in';
	if (row.reminderSentAt) return 'reminder';
	const acceptedAt = row.createdAt?.getTime() ?? now.getTime();
	const days = (now.getTime() - acceptedAt) / 86_400_000;
	if (days >= REMINDER_AFTER_DAYS) return 'reminder'; // needs a reminder
	return 'accepted';
}

/** Append a timeline event. `actorUserId` null = system event. */
export async function addEvent(
	onboardingId: string,
	type: string,
	detail: string | null = null,
	actorUserId: string | null = null
): Promise<void> {
	await db.insert(memberOnboardingEvents).values({ onboardingId, type, detail, actorUserId });
}

/**
 * Idempotently create the onboarding row for an accepted application. Called
 * from the application confirm flow (and the backfill). Safe to call repeatedly
 * — returns the existing row id if one already exists for the application.
 */
export async function ensureOnboardingRow(application: {
	id: string;
	fullName: string;
	email: string;
	confirmationEmailSentAt?: string | null;
}): Promise<string> {
	const existing = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.applicationId, application.id)
	});
	if (existing) return existing.id;

	// Anchor the acceptance time (drives the 7-day reminder clock) to when the
	// confirmation email was sent, falling back to now.
	const acceptedAt = application.confirmationEmailSentAt
		? new Date(application.confirmationEmailSentAt)
		: new Date();

	// Link a user immediately if one already exists with this email.
	const linkedUser = await db.query.user.findFirst({
		where: eq(userTable.email, application.email)
	});

	const [row] = await db
		.insert(memberOnboarding)
		.values({
			applicationId: application.id,
			userId: linkedUser?.id ?? null,
			email: application.email,
			fullName: application.fullName,
			createdAt: acceptedAt,
			updatedAt: new Date()
		})
		.returning({ id: memberOnboarding.id });

	await addEvent(row.id, 'accepted', `Accepted — welcome email sent to ${application.email}`, null);
	if (linkedUser) {
		await addEvent(row.id, 'logged_in', 'Member account already active', null);
	}
	return row.id;
}

/** Latest session.createdAt per user → best available "last login" signal. */
async function getLastLoginMap(userIds: string[]): Promise<Map<string, Date>> {
	if (userIds.length === 0) return new Map();
	const rows = await db
		.select({ userId: sessionTable.userId, createdAt: sessionTable.createdAt })
		.from(sessionTable)
		.where(inArray(sessionTable.userId, userIds));
	const map = new Map<string, Date>();
	for (const r of rows) {
		if (!r.createdAt) continue;
		const cur = map.get(r.userId);
		if (!cur || r.createdAt > cur) map.set(r.userId, r.createdAt);
	}
	return map;
}

export interface OnboardingCard {
	id: string;
	email: string;
	fullName: string;
	applicationId: string | null;
	userId: string | null;
	stage: Stage;
	acceptedAt: string | null;
	lastLoginAt: string | null;
	reminderSentAt: string | null;
	buddyCallInvitedAt: string | null;
	buddyCallAt: string | null;
	buddyCallWith: string | null;
	buddyCallSkippedAt: string | null;
	dormantAt: string | null;
	onboardingCompletedAt: string | null;
	avatarUrl: string | null;
	noteCount: number;
	daysSinceAccepted: number | null;
}

/**
 * Assemble the full board. Side effect: lazily link `userId` by email the first
 * time an account is detected, and append a `logged_in` timeline event.
 */
export async function getEnrichedBoard(): Promise<OnboardingCard[]> {
	const rows = await db.query.memberOnboarding.findMany({
		orderBy: [desc(memberOnboarding.createdAt)]
	});
	if (rows.length === 0) return [];

	const users = await db.query.user.findMany();
	const usersByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

	// Lazy-link newly enrolled members.
	for (const row of rows) {
		if (row.userId) continue;
		const matched = usersByEmail.get(row.email.toLowerCase());
		if (matched) {
			await db
				.update(memberOnboarding)
				.set({ userId: matched.id, updatedAt: new Date() })
				.where(eq(memberOnboarding.id, row.id));
			row.userId = matched.id;
			await addEvent(row.id, 'logged_in', 'Member logged in (account detected)', null);
			onboardingLogger.info({ onboardingId: row.id, email: row.email }, 'Linked onboarding to user');
		}
	}

	const linkedUserIds = rows.map((r) => r.userId).filter((id): id is string => !!id);
	const lastLoginMap = await getLastLoginMap(linkedUserIds);
	const usersById = new Map(users.map((u) => [u.id, u]));

	// Note counts per onboarding row.
	const noteCounts = new Map<string, number>();
	const allNotes = await db
		.select({ onboardingId: memberOnboardingNotes.onboardingId })
		.from(memberOnboardingNotes)
		.where(inArray(memberOnboardingNotes.onboardingId, rows.map((r) => r.id)));
	for (const n of allNotes) {
		noteCounts.set(n.onboardingId, (noteCounts.get(n.onboardingId) ?? 0) + 1);
	}

	const now = new Date();
	return rows.map((row) => {
		const linkedUser = row.userId ? usersById.get(row.userId) ?? null : null;
		const stage = deriveStage(row, linkedUser, now);
		const acceptedAt = row.createdAt ?? null;
		const lastLoginAt = linkedUser ? lastLoginMap.get(linkedUser.id) ?? null : null;
		return {
			id: row.id,
			email: row.email,
			fullName: row.fullName,
			applicationId: row.applicationId,
			userId: row.userId,
			stage,
			acceptedAt: acceptedAt?.toISOString() ?? null,
			lastLoginAt: lastLoginAt?.toISOString() ?? null,
			reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
			buddyCallInvitedAt: row.buddyCallInvitedAt?.toISOString() ?? null,
			buddyCallAt: row.buddyCallAt?.toISOString() ?? null,
			buddyCallWith: row.buddyCallWith,
			buddyCallSkippedAt: row.buddyCallSkippedAt?.toISOString() ?? null,
			dormantAt: row.dormantAt?.toISOString() ?? null,
			onboardingCompletedAt: linkedUser?.onboardingCompletedAt?.toISOString() ?? null,
			avatarUrl: linkedUser?.image ?? null,
			noteCount: noteCounts.get(row.id) ?? 0,
			daysSinceAccepted: acceptedAt
				? Math.floor((now.getTime() - acceptedAt.getTime()) / 86_400_000)
				: null
		};
	});
}

/**
 * One-time backfill: create onboarding rows for every approved application that
 * has had its confirmation email sent but has no onboarding row yet. Returns the
 * number of rows created. Idempotent.
 */
export async function backfillOnboardingRows(): Promise<number> {
	const approved = await db
		.select()
		.from(applications)
		.where(isNotNull(applications.confirmationEmailSentAt));

	let created = 0;
	for (const app of approved) {
		if (app.status === 'cancelled') continue;
		const existing = await db.query.memberOnboarding.findFirst({
			where: eq(memberOnboarding.applicationId, app.id)
		});
		if (existing) continue;
		await ensureOnboardingRow(app);
		created++;
	}
	onboardingLogger.info({ created }, 'Backfilled member onboarding rows');
	return created;
}
