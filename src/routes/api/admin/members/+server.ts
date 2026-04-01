import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user, applications } from '$lib/server/db/schema';
import { desc, isNotNull } from 'drizzle-orm';

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

            // Determine onboarding status from lifecycle timestamps
            let onboardingStatus: 'Not Started' | 'In Progress' | 'Complete' = 'Not Started';
            if (u.onboardingCompletedAt) {
                onboardingStatus = 'Complete';
            } else if (u.onboardingStartedAt) {
                onboardingStatus = 'In Progress';
            } else if (u.onboardingProgress) {
                // Fallback: check progress JSON for users who started before timestamps were added
                try {
                    const progress = JSON.parse(u.onboardingProgress);
                    if (Object.keys(progress).length > 0) onboardingStatus = 'In Progress';
                } catch {
                    // ignore
                }
            }

            return {
                id: u.id,
                name: u.name,
                email: u.email,
                groups: groups,
                lastLogin: u.updatedAt?.toISOString() || null, // Best proxy for now
                onboardingStatus,
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
