import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals } from '$lib/server/db/schema';
import { eq, notExists, sql } from 'drizzle-orm';
import { createSystemProposal } from '$lib/server/voting/system-proposal';
import { formatApplicationBody } from '$lib/server/voting/format-application';
import { votingLogger } from '$lib/server/logger';

/**
 * One-shot backfill: create a local voting proposal for any application
 * submitted before the auto-creation flow shipped. Idempotent because
 * createSystemProposal short-circuits on a matching linkedApplicationId.
 *
 * Admin-gated. Safe to call repeatedly.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const groups = (() => {
		try {
			return JSON.parse(locals.user.groups || '[]') as string[];
		} catch {
			return [] as string[];
		}
	})();
	if (!groups.includes('EcoHubs Admin')) error(403, 'Admin access required');

	const orphans = await db
		.select()
		.from(applications)
		.where(
			notExists(
				db
					.select({ one: sql`1` })
					.from(proposals)
					.where(eq(proposals.linkedApplicationId, applications.id))
			)
		);

	let created = 0;
	let failed = 0;
	for (const app of orphans) {
		try {
			await createSystemProposal({
				type: 'operational',
				choiceSetKey: 'membership',
				tags: ['membership', 'system', 'backfill'],
				title: `Membership Application: ${app.fullName}`,
				body: formatApplicationBody(app),
				linkedApplicationId: app.id
			});
			if (app.status === 'pending') {
				await db
					.update(applications)
					.set({ status: 'proposal_created' })
					.where(eq(applications.id, app.id));
			}
			created++;
		} catch (err) {
			failed++;
			votingLogger.error({ err, applicationId: app.id }, 'backfill: failed to create proposal');
		}
	}

	return json({
		success: true,
		scanned: orphans.length,
		created,
		failed
	});
};
