import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user, applications, session } from '$lib/server/db/schema';
import { desc, isNotNull, max } from 'drizzle-orm';
import { completionRequiredSubstepIds } from '$lib/onboarding/stepManager';
import { daysSinceParticipation } from '$lib/server/participation';

export const GET: RequestHandler = async ({ locals }) => {
	// Authentication check
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	// Authorization check: Must be 'EcoHubs Admin'
	const userGroups = locals.user.groups ? JSON.parse(locals.user.groups as unknown as string) : [];
	if (!userGroups.includes('EcoHubs Admin')) {
		error(403, 'Forbidden: Admin access required');
	}

	try {
		// Fetch all users
		const allUsers = await db.query.user.findMany({
			orderBy: [desc(user.createdAt)]
		});

		const userEmails = new Set(allUsers.map((u) => u.email.toLowerCase()));

		// Last login, from the session table rather than `user.updatedAt`.
		//
		// updatedAt was only ever a proxy, and a poor one: *any* write moves it —
		// a profile edit, a group change, participation bookkeeping. The membership
		// backfill made that plain by stamping ten accounts at once, so the column
		// read "logged in today" for people who had not logged in at all.
		//
		// A session row is created when someone actually signs in, so max(created_at)
		// is the real thing. Null means no session on record — including members
		// whose sessions were revoked on exit, which is the truthful answer.
		const lastSessions = await db
			.select({ userId: session.userId, at: max(session.createdAt) })
			.from(session)
			.groupBy(session.userId);
		const lastLoginByUser = new Map<string, Date | null>(
			lastSessions.map((r) => [
				r.userId,
				// max() bypasses drizzle's timestamp decoding, so revive the raw value.
				r.at === null || r.at === undefined
					? null
					: r.at instanceof Date
						? r.at
						: new Date(Number(r.at) * 1000)
			])
		);

		const members = allUsers.map((u) => {
			// Parse groups if stored as string
			let groups: string[] = [];
			try {
				groups = u.groups ? JSON.parse(u.groups) : [];
			} catch (e) {
				// fallback if not json
				if (typeof u.groups === 'string') groups = [u.groups];
			}

			// Determine onboarding status by merging the member's completed
			// substeps with the CURRENT required flow. Deriving from progress
			// (rather than the onboardingCompletedAt timestamp alone) means a
			// member who finished an older, longer flow — whose steps have
			// since been removed — is correctly shown as Complete instead of
			// being stuck on "In Progress".
			let progress: Record<string, string> = {};
			try {
				progress = u.onboardingProgress ? JSON.parse(u.onboardingProgress) : {};
			} catch {
				progress = {};
			}
			const requiredIds = completionRequiredSubstepIds();
			const pendingSteps = requiredIds.filter((id) => !progress[id]);
			const hasAnyProgress = Object.keys(progress).length > 0;

			let onboardingStatus: 'Not Started' | 'In Progress' | 'Complete' = 'Not Started';
			if (u.onboardingCompletedAt || (requiredIds.length > 0 && pendingSteps.length === 0)) {
				onboardingStatus = 'Complete';
			} else if (hasAnyProgress || u.onboardingStartedAt) {
				onboardingStatus = 'In Progress';
			}

			return {
				id: u.id,
				name: u.name,
				email: u.email,
				groups: groups,
				// Role is derived from groups on the client; status is not derivable,
				// and a members list that cannot show standby or exited is misleading
				// now that those states exist.
				membershipStatus: (u.membershipStatus ?? 'active') as 'active' | 'standby' | 'exited',
				lastLogin: lastLoginByUser.get(u.id)?.toISOString() ?? null,
				onboardingStatus,
				onboardingPending: pendingSteps,
				onboardingProgress: u.onboardingProgress,
				onboardingStartedAt: u.onboardingStartedAt?.toISOString() || null,
				onboardingCompletedAt: u.onboardingCompletedAt?.toISOString() || null,
				// The cached Offcoin snapshot, refreshed by the level sync and by any
				// page that fetches live figures. Null means never synced, which the
				// UI shows as "--" rather than as a zero the member has not earned.
				xp: u.offcoinXp,
				eco: u.offcoinEco,
				level: u.offcoinLevel,
				avatarUrl: u.image,
				walletAddress: u.walletAddress || null,
				introWatchedAt: u.introWatchedAt?.toISOString() ?? null,
				lastParticipationAt: u.lastParticipationAt?.toISOString() ?? null,
				lastParticipationSource: u.lastParticipationSource ?? null,
				daysSinceParticipation: daysSinceParticipation(u.lastParticipationAt ?? null),
				pendingLogin: false
			};
		});

		// Fetch approved applicants who received confirmation email but never logged in
		const approvedApplicants = await db
			.select()
			.from(applications)
			.where(isNotNull(applications.confirmationEmailSentAt))
			.orderBy(desc(applications.submittedAt));

		const pendingLoginMembers = approvedApplicants
			.filter((app) => !userEmails.has(app.email.toLowerCase()))
			.map((app) => ({
				id: `pending-${app.id}`,
				name: app.fullName,
				email: app.email,
				groups: [],
				membershipStatus: 'active' as const,
				lastLogin: null,
				onboardingStatus: 'Pending Login' as const,
				onboardingPending: [] as string[],
				onboardingProgress: '',
				onboardingStartedAt: null,
				onboardingCompletedAt: null,
				xp: null,
				eco: null,
				level: null,
				avatarUrl: null,
				walletAddress: null,
				introWatchedAt: null,
				// Never logged in, so no participation signal can exist yet.
				lastParticipationAt: null,
				lastParticipationSource: null,
				daysSinceParticipation: null,
				pendingLogin: true,
				inviteSentAt: app.confirmationEmailSentAt
			}));

		return json({ members: [...members, ...pendingLoginMembers] });
	} catch (e) {
		console.error('Error fetching members:', e);
		error(500, 'Internal Server Error');
	}
};
