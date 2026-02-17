import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';

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
        const logFilePath = env.LOG_FILE?.trim() || 'logs/ecohubsOS.log';
        // Ensure path is safe/absolute or relative to cwd
        const absoluteLogPath = path.resolve(process.cwd(), logFilePath);

        try {
            await fs.access(absoluteLogPath);
        } catch {
            // File doesn't exist or not accessible
            return json({ logs: [] });
        }

        const fileContent = await fs.readFile(absoluteLogPath, 'utf-8');
        const lines = fileContent.trim().split('\n');

        // Parse last 1000 lines (or fewer) to avoid huge payload
        const recentLines = lines.slice(-1000).reverse(); // Newest first

        const logs = recentLines
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(log => log !== null);

        return json({ logs });
    } catch (e) {
        console.error('Error fetching logs:', e);
        error(500, 'Internal Server Error');
    }
};
