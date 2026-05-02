import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals, proposalVotes } from '$lib/server/db/schema';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { createSystemProposal } from '$lib/server/voting/system-proposal';
import { formatApplicationBody } from '$lib/server/voting/format-application';
import { getChoices } from '$lib/server/voting/choice-sets';
import { TYPE_CONFIG } from '$lib/server/voting/periods';
import { votingLogger } from '$lib/server/logger';

type Application = typeof applications.$inferSelect;
type Proposal = typeof proposals.$inferSelect;

interface InferredOutcome {
	status: 'active' | 'closed';
	result: 'approved' | 'rejected' | null;
}

/**
 * Reads the application's existing state to decide whether the
 * corresponding voting proposal should be active (genuinely pending) or
 * already-closed (a decision was made historically). Used both when
 * creating new backfill proposals and when repairing the ones that an
 * earlier run of this endpoint created with the wrong state.
 *
 * Priority (most authoritative first):
 *  - confirmationEmailSentAt set ⇒ welcome email shipped ⇒ approved
 *  - rejectionEmailSentAt set    ⇒ rejection email shipped ⇒ rejected
 *  - application.status explicit ⇒ use that
 *  - else ⇒ genuinely pending; the proposal opens active for voting
 */
function inferOutcome(app: Application): InferredOutcome {
	if (app.confirmationEmailSentAt || app.status === 'approved') {
		return { status: 'closed', result: 'approved' };
	}
	if (app.rejectionEmailSentAt || app.status === 'rejected') {
		return { status: 'closed', result: 'rejected' };
	}
	return { status: 'active', result: null };
}

/**
 * Inserts a closed-state proposal directly (bypassing
 * createSystemProposal which always uses current timestamps + active
 * status). Pre-marks discordNotifiedTransitions so the materialiser
 * doesn't fire a "proposal closed" ping for historical decisions.
 */
async function createClosedProposal(app: Application, outcome: InferredOutcome) {
	if (outcome.status !== 'closed' || !outcome.result) return;

	const choices = getChoices('membership');
	const config = TYPE_CONFIG.operational;
	// Anchor the period to the original submission so the timeline
	// looks correct in the proposal detail view AND so the list orders
	// chronologically by application date (most recent first).
	const submittedAt = app.submittedAt ? new Date(app.submittedAt) : new Date();
	const voteClosesAt = new Date(
		submittedAt.getTime() + config.voteDays * 24 * 60 * 60 * 1000
	);
	// If the natural close date is in the future (recent application),
	// pull it back to the submission moment so it's unambiguously closed.
	const past = voteClosesAt.getTime() > Date.now() ? new Date(submittedAt.getTime() + 1) : voteClosesAt;

	await db.insert(proposals).values({
		type: 'operational',
		title: `Membership Application: ${app.fullName}`,
		body: formatApplicationBody(app),
		authorUserId: null,
		tags: JSON.stringify(['membership', 'system', 'backfill']),
		choiceSetKey: 'membership',
		choices: JSON.stringify(choices),
		threshold: config.threshold,
		// createdAt = submittedAt so list ordering by createdAt DESC
		// reflects natural application chronology, not the backfill instant.
		createdAt: submittedAt,
		voteOpensAt: submittedAt,
		voteClosesAt: past,
		ratificationEndsAt: null,
		status: 'closed',
		result: outcome.result,
		// Mark Discord as already notified so the materialiser doesn't
		// fire pings retroactively for historical decisions.
		discordNotifiedTransitions: JSON.stringify([`closed:${outcome.result}`]),
		linkedApplicationId: app.id
	});
}

async function repairProposal(
	existing: Proposal,
	app: Application,
	outcome: InferredOutcome
): Promise<'repaired' | 'skipped-has-votes' | 'skipped-already-closed'> {
	if (existing.status !== 'active') return 'skipped-already-closed';
	if (outcome.status !== 'closed' || !outcome.result) return 'skipped-already-closed';

	// Don't overwrite if any votes have been cast on this proposal —
	// respect the live vote in flight. (Unlikely on a freshly-backfilled
	// proposal but guarded for safety.)
	const [voteRow] = await db
		.select({ n: sql<number>`count(*)` })
		.from(proposalVotes)
		.where(eq(proposalVotes.proposalId, existing.id));
	if (Number(voteRow?.n ?? 0) > 0) return 'skipped-has-votes';

	const submittedAt = app.submittedAt ? new Date(app.submittedAt) : new Date();
	const close = existing.voteClosesAt.getTime() > Date.now()
		? new Date(Date.now() - 1)
		: existing.voteClosesAt;

	await db
		.update(proposals)
		.set({
			status: 'closed',
			result: outcome.result,
			// Re-anchor createdAt + voteOpensAt to the application's actual
			// submission so the list orders chronologically. The original
			// values were both ≈ backfill instant, which collapsed every
			// historical row to roughly the same timestamp.
			createdAt: submittedAt,
			voteOpensAt: submittedAt,
			voteClosesAt: close,
			// Re-render the body so emails / surnames are obscured for
			// historical proposals that were backfilled before the
			// privacy formatter shipped.
			body: formatApplicationBody(app),
			discordNotifiedTransitions: JSON.stringify([`closed:${outcome.result}`])
		})
		.where(eq(proposals.id, existing.id));

	return 'repaired';
}

/**
 * One-shot backfill / repair endpoint for membership proposals.
 *
 * - Creates a local proposal for any application that doesn't have one
 *   yet, with the proposal already in its correct historical state
 *   (closed/approved, closed/rejected, or active for genuinely pending).
 * - Repairs any backfill-tagged proposals that an earlier run created
 *   in `active` state when the application was already decided. Repair
 *   skips proposals that have received votes since.
 *
 * Admin-gated, idempotent, safe to re-run.
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

	let createdActive = 0;
	let createdClosed = 0;
	let repaired = 0;
	let skippedHasVotes = 0;
	let failed = 0;

	// 1) Create proposals for orphaned applications.
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

	for (const app of orphans) {
		try {
			const outcome = inferOutcome(app);
			if (outcome.status === 'closed') {
				await createClosedProposal(app, outcome);
				createdClosed++;
			} else {
				const created = await createSystemProposal({
					type: 'operational',
					choiceSetKey: 'membership',
					tags: ['membership', 'system', 'backfill'],
					title: `Membership Application: ${app.fullName}`,
					body: formatApplicationBody(app),
					linkedApplicationId: app.id
				});
				// For genuinely-pending applications: the vote is fresh
				// (closes 3 days from now), but the proposal's `createdAt`
				// is re-anchored to the application's submittedAt so the
				// list still orders chronologically.
				if (app.submittedAt) {
					await db
						.update(proposals)
						.set({ createdAt: new Date(app.submittedAt) })
						.where(eq(proposals.id, created.id));
				}
				createdActive++;
			}
			if (app.status === 'pending') {
				await db
					.update(applications)
					.set({ status: 'proposal_created' })
					.where(eq(applications.id, app.id));
			}
		} catch (err) {
			failed++;
			votingLogger.error({ err, applicationId: app.id }, 'backfill: create failed');
		}
	}

	// 2) Repair existing backfill-tagged proposals that are still active
	//    when the application's state says they should be closed.
	const stragglers = await db
		.select({ proposal: proposals, app: applications })
		.from(proposals)
		.innerJoin(applications, eq(applications.id, proposals.linkedApplicationId))
		.where(
			and(
				eq(proposals.status, 'active'),
				// json_each scan to match only backfill-tagged rows
				sql`exists (select 1 from json_each(${proposals.tags}) where json_each.value = 'backfill')`
			)
		);

	for (const { proposal, app } of stragglers) {
		try {
			const outcome = inferOutcome(app);
			const result = await repairProposal(proposal, app, outcome);
			if (result === 'repaired') repaired++;
			else if (result === 'skipped-has-votes') skippedHasVotes++;
		} catch (err) {
			failed++;
			votingLogger.error({ err, proposalId: proposal.id }, 'backfill: repair failed');
		}
	}

	votingLogger.info(
		{ createdActive, createdClosed, repaired, skippedHasVotes, failed },
		'backfill complete'
	);

	return json({
		success: true,
		createdActive,
		createdClosed,
		repaired,
		skippedHasVotes,
		failed
	});
};
