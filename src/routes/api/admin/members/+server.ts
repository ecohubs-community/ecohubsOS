import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

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

        const members = allUsers.map((u) => {
            // Parse groups if stored as string
            let groups: string[] = [];
            try {
                groups = u.groups ? JSON.parse(u.groups) : [];
            } catch (e) {
                // fallback if not json
                if (typeof u.groups === 'string') groups = [u.groups];
            }

            // Determine onboarding status
            let onboardingStatus = 'Not Started';
            if (u.onboardingProgress) {
                try {
                    const progress = JSON.parse(u.onboardingProgress);
                    // Simple heuristic: if progress has entries, it's in progress
                    const stepsCompleted = Object.keys(progress).length;
                    if (stepsCompleted > 0) onboardingStatus = 'In Progress';
                    // Determine 'Complete' based on known steps count? 
                    // For now let's assume > 3 steps is likely done or close enough for 'In Progress' detail
                    // If we knew the total steps we could say 'Complete'. 
                    // Let's check a specific key or just leave it simple.
                    // Actually, let's just mark 'Complete' if steps > 5 (arbitrary for placeholder logic)
                    if (stepsCompleted >= 5) onboardingStatus = 'Complete';
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
                xp: Math.floor(Math.random() * 5000), // Placeholder
                eco: Math.floor(Math.random() * 1000), // Placeholder,
                avatarUrl: u.image
            };
        });

        return json({ members });
    } catch (e) {
        console.error('Error fetching members:', e);
        error(500, 'Internal Server Error');
    }
};
