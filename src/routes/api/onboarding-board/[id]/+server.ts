import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStewardOrAdmin } from '$lib/server/authz';
import { db } from '$lib/server/db';
import {
	memberOnboarding,
	memberOnboardingNotes,
	memberOnboardingEvents,
	user as userTable
} from '$lib/server/db/schema';
import { eq, asc, desc, inArray } from 'drizzle-orm';
import { deriveStage } from '$lib/server/member-onboarding/service';
import { buildBuddyCallTemplate } from '$lib/server/member-onboarding/emailTemplates';

// GET — full detail for one onboarding journey: member data, notes, timeline,
// plus a pre-filled buddy-call template for the current steward.
export const GET: RequestHandler = async ({ params, locals }) => {
	requireStewardOrAdmin(locals);

	const row = await db.query.memberOnboarding.findFirst({
		where: eq(memberOnboarding.id, params.id)
	});
	if (!row) error(404, 'Onboarding record not found');

	const linkedUser = row.userId
		? await db.query.user.findFirst({ where: eq(userTable.id, row.userId) })
		: null;

	const notes = await db
		.select()
		.from(memberOnboardingNotes)
		.where(eq(memberOnboardingNotes.onboardingId, row.id))
		.orderBy(desc(memberOnboardingNotes.createdAt));

	const events = await db
		.select()
		.from(memberOnboardingEvents)
		.where(eq(memberOnboardingEvents.onboardingId, row.id))
		.orderBy(asc(memberOnboardingEvents.createdAt));

	// Resolve display names for every referenced actor/author.
	const refIds = new Set<string>();
	for (const id of [
		row.reminderSentBy,
		row.buddyCallInvitedBy,
		row.buddyCallSkippedBy,
		row.dormantBy
	])
		if (id) refIds.add(id);
	for (const n of notes) if (n.createdBy) refIds.add(n.createdBy);
	for (const e of events) if (e.actorUserId) refIds.add(e.actorUserId);
	const nameMap = new Map<string, string>();
	if (refIds.size > 0) {
		const refUsers = await db
			.select({ id: userTable.id, name: userTable.name })
			.from(userTable)
			.where(inArray(userTable.id, [...refIds]));
		for (const u of refUsers) nameMap.set(u.id, u.name);
	}

	const senderName = locals.user!.name;
	const buddyCallTemplate = buildBuddyCallTemplate({
		recipientName: row.fullName,
		senderName,
		schedulingUrl: locals.user!.meetingSchedulingUrl ?? null
	});

	return json({
		id: row.id,
		email: row.email,
		fullName: row.fullName,
		applicationId: row.applicationId,
		userId: row.userId,
		stage: deriveStage(row, linkedUser ?? null),
		acceptedAt: row.createdAt?.toISOString() ?? null,
		reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
		reminderSentBy: row.reminderSentBy ? nameMap.get(row.reminderSentBy) ?? null : null,
		buddyCallInvitedAt: row.buddyCallInvitedAt?.toISOString() ?? null,
		buddyCallInvitedBy: row.buddyCallInvitedBy
			? nameMap.get(row.buddyCallInvitedBy) ?? null
			: null,
		buddyCallAt: row.buddyCallAt?.toISOString() ?? null,
		buddyCallWith: row.buddyCallWith,
		buddyCallSkippedAt: row.buddyCallSkippedAt?.toISOString() ?? null,
		buddyCallSkippedBy: row.buddyCallSkippedBy
			? nameMap.get(row.buddyCallSkippedBy) ?? null
			: null,
		dormantAt: row.dormantAt?.toISOString() ?? null,
		dormantBy: row.dormantBy ? nameMap.get(row.dormantBy) ?? null : null,
		onboardingCompletedAt: linkedUser?.onboardingCompletedAt?.toISOString() ?? null,
		onboardingStartedAt: linkedUser?.onboardingStartedAt?.toISOString() ?? null,
		avatarUrl: linkedUser?.image ?? null,
		notes: notes.map((n) => ({
			id: n.id,
			text: n.text,
			createdBy: n.createdBy ? nameMap.get(n.createdBy) ?? null : null,
			createdAt: n.createdAt?.toISOString() ?? null,
			updatedAt: n.updatedAt?.toISOString() ?? null
		})),
		events: events.map((e) => ({
			id: e.id,
			type: e.type,
			detail: e.detail,
			actor: e.actorUserId ? nameMap.get(e.actorUserId) ?? null : null,
			createdAt: e.createdAt?.toISOString() ?? null
		})),
		buddyCallTemplate,
		senderName
	});
};
