import { db } from '$lib/server/db';
import { proposals } from '$lib/server/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { computePeriods, TYPE_CONFIG, type ProposalType } from './periods';
import { getChoices, type ChoiceSetKey } from './choice-sets';
import { sendDiscordMessage } from '$lib/server/discord';
import { newProposalMessage } from '$lib/server/discord-templates';
import { votingLogger } from '$lib/server/logger';

interface CreateSystemProposalInput {
	type: ProposalType;
	choiceSetKey: ChoiceSetKey;
	tags: string[];
	title: string;
	body: string;
	linkedApplicationId?: string;
	linkedBlogDraftId?: string;
	/**
	 * Skip the "new proposal" Discord ping. Useful when the calling flow
	 * already announces the same underlying event (e.g. membership
	 * applications post their own "new application arrived" message).
	 */
	skipDiscord?: boolean;
}

type ProposalRow = typeof proposals.$inferSelect;

/**
 * Create a system-authored proposal (membership / blog flows).
 *
 * Idempotent on `linkedApplicationId` / `linkedBlogDraftId`: if a proposal
 * already exists for the linked entity, the existing row is returned and
 * no Discord message is fired. Safe to call from request retries.
 */
export async function createSystemProposal(
	input: CreateSystemProposalInput
): Promise<ProposalRow> {
	const { linkedApplicationId, linkedBlogDraftId } = input;

	if (linkedApplicationId || linkedBlogDraftId) {
		const conditions = [];
		if (linkedApplicationId)
			conditions.push(eq(proposals.linkedApplicationId, linkedApplicationId));
		if (linkedBlogDraftId) conditions.push(eq(proposals.linkedBlogDraftId, linkedBlogDraftId));
		const [existing] = await db
			.select()
			.from(proposals)
			.where(conditions.length === 1 ? conditions[0] : or(...conditions));
		if (existing) return existing;
	}

	const config = TYPE_CONFIG[input.type];
	const periods = computePeriods(input.type);
	const choices = getChoices(input.choiceSetKey);
	const initialStatus = config.deliberationDays === 0 ? 'active' : 'deliberating';

	const [created] = await db
		.insert(proposals)
		.values({
			type: input.type,
			title: input.title,
			body: input.body,
			authorUserId: null, // system
			tags: JSON.stringify(input.tags),
			choiceSetKey: input.choiceSetKey,
			choices: JSON.stringify(choices),
			threshold: config.threshold,
			voteOpensAt: periods.voteOpensAt,
			voteClosesAt: periods.voteClosesAt,
			ratificationEndsAt: periods.ratificationEndsAt,
			status: initialStatus,
			linkedApplicationId: linkedApplicationId ?? null,
			linkedBlogDraftId: linkedBlogDraftId ?? null
		})
		.returning();

	if (!input.skipDiscord) {
		try {
			await sendDiscordMessage({
				content: newProposalMessage({
					title: created.title,
					type: created.type,
					authorName: 'System'
				})
			});
		} catch (err) {
			votingLogger.error({ err, proposalId: created.id }, 'Discord notification failed');
		}
	}

	votingLogger.info(
		{
			proposalId: created.id,
			type: created.type,
			linkedApplicationId,
			linkedBlogDraftId
		},
		'system proposal created'
	);

	return created;
}
