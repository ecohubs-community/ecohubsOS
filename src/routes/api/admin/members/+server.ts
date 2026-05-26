import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user, applications } from '$lib/server/db/schema';
import { desc, isNotNull } from 'drizzle-orm';
import { completionRequiredSubstepIds } from '$lib/onboarding/stepManager';

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
                lastLogin: u.updatedAt?.toISOString() || null, // Best proxy for now
                onboardingStatus,
                onboardingPending: pendingSteps,
                onboardingProgress: u.onboardingProgress,
                onboardingStartedAt: u.onboardingStartedAt?.toISOString() || null,
                onboardingCompletedAt: u.onboardingCompletedAt?.toISOString() || null,
                xp: Math.floor(Math.random() * 5000), // Placeholder
                eco: Math.floor(Math.random() * 1000), // Placeholder,
                avatarUrl: u.image,
                walletAddress: u.walletAddress || null,
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
                lastLogin: null,
                onboardingStatus: 'Pending Login' as const,
                onboardingPending: [] as string[],
                onboardingProgress: '',
                onboardingStartedAt: null,
                onboardingCompletedAt: null,
                xp: 0,
                eco: 0,
                avatarUrl: null,
                walletAddress: null,
                pendingLogin: true,
                inviteSentAt: app.confirmationEmailSentAt
            }));

        return json({ members: [...members, ...pendingLoginMembers] });
    } catch (e) {
        console.error('Error fetching members:', e);
        error(500, 'Internal Server Error');
    }
};
