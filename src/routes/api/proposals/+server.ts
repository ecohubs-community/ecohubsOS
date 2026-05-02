import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { proposals, proposalVotes } from '$lib/server/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { sendDiscordMessage } from '$lib/server/discord';
import { newProposalMessage } from '$lib/server/discord-templates';
import { votingLogger } from '$lib/server/logger';
import { computePeriods, isValidProposalType, TYPE_CONFIG } from '$lib/server/voting/periods';
import { getChoices } from '$lib/server/voting/choice-sets';
import { canAuthorProposal } from '$lib/server/voting/eligibility';
import { materialiseAllStale } from '$lib/server/voting/materialise';
import { checkRateLimit, PROPOSAL_CREATE_RATE_LIMIT } from '$lib/server/rateLimit';

const TITLE_MAX = 140;
const BODY_MAX = 10_000;
const TAG_MAX = 5;
const TAG_MAX_LEN = 30;
const TAG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ACTIVE_STATUSES = ['deliberating', 'active'] as const;
const PAST_STATUSES = ['closed', 'ratifying', 'ratified', 'withdrawn'] as const;

function normaliseTag(raw: string): string | null {
	const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-');
	if (!trimmed || trimmed.length > TAG_MAX_LEN) return null;
	if (!TAG_REGEX.test(trimmed)) return null;
	return trimmed;
}

function parseTags(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function parseChoices(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

// GET /api/proposals — list proposals with vote counts and userHasVoted flag.
// Query params: status=active|past|all (default: active), type=..., tag=..., unvoted=1.
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	await materialiseAllStale();

	const statusParam = url.searchParams.get('status') ?? 'active';
	const typeParam = url.searchParams.get('type');
	const tagParam = url.searchParams.get('tag');
	const unvotedParam = url.searchParams.get('unvoted') === '1';

	const conditions = [];
	if (statusParam === 'active') {
		conditions.push(inArray(proposals.status, [...ACTIVE_STATUSES]));
	} else if (statusParam === 'past') {
		conditions.push(inArray(proposals.status, [...PAST_STATUSES]));
	}
	if (typeParam && isValidProposalType(typeParam)) {
		conditions.push(eq(proposals.type, typeParam));
	}
	if (tagParam) {
		const norm = normaliseTag(tagParam);
		if (norm) {
			conditions.push(
				sql`exists (select 1 from json_each(${proposals.tags}) where json_each.value = ${norm})`
			);
		}
	}

	const rows = await db
		.select()
		.from(proposals)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(proposals.createdAt));

	if (rows.length === 0) return json({ proposals: [] });

	const proposalIds = rows.map((r) => r.id);

	// Tally votes per proposal+choice
	const tallyRows = await db
		.select({
			proposalId: proposalVotes.proposalId,
			choice: proposalVotes.choice,
			n: sql<number>`count(*)`
		})
		.from(proposalVotes)
		.where(inArray(proposalVotes.proposalId, proposalIds))
		.groupBy(proposalVotes.proposalId, proposalVotes.choice);

	const tallyMap = new Map<string, Record<string, number>>();
	for (const r of tallyRows) {
		const m = tallyMap.get(r.proposalId) ?? {};
		m[r.choice] = Number(r.n);
		tallyMap.set(r.proposalId, m);
	}

	// Which proposals has the caller voted on?
	const userVotes = await db
		.select({ proposalId: proposalVotes.proposalId })
		.from(proposalVotes)
		.where(
			and(
				inArray(proposalVotes.proposalId, proposalIds),
				eq(proposalVotes.userId, locals.user.id)
			)
		);
	const votedSet = new Set(userVotes.map((v) => v.proposalId));

	let result = rows.map((row) => {
		const tallies = tallyMap.get(row.id) ?? {};
		const total = Object.values(tallies).reduce((a, b) => a + b, 0);
		return {
			id: row.id,
			type: row.type,
			title: row.title,
			tags: parseTags(row.tags),
			choiceSetKey: row.choiceSetKey,
			choices: parseChoices(row.choices),
			threshold: row.threshold,
			status: row.status,
			result: row.result,
			authorUserId: row.authorUserId,
			createdAt: row.createdAt,
			voteOpensAt: row.voteOpensAt,
			voteClosesAt: row.voteClosesAt,
			ratificationEndsAt: row.ratificationEndsAt,
			linkedApplicationId: row.linkedApplicationId,
			linkedBlogDraftId: row.linkedBlogDraftId,
			votesByChoice: tallies,
			votesTotal: total,
			userHasVoted: votedSet.has(row.id)
		};
	});

	if (unvotedParam) {
		result = result.filter((r) => !r.userHasVoted && r.status === 'active');
	}

	return json({ proposals: result });
};

// POST /api/proposals — create a member-authored proposal.
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	if (!checkRateLimit(PROPOSAL_CREATE_RATE_LIMIT, locals.user.id)) {
		error(429, 'Too many proposals — please wait before creating another');
	}

	const eligible = await canAuthorProposal({
		id: locals.user.id,
		puckstackUserId: locals.user.puckstackUserId
	});
	if (!eligible) error(403, 'Offcoin Level 3 or higher required to create a proposal');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const {
		type,
		title,
		body: proposalBody,
		tags
	} = body as {
		type?: string;
		title?: string;
		body?: string;
		tags?: unknown;
	};

	if (!type || !isValidProposalType(type)) {
		error(400, 'Invalid type — must be one of operational, strategic, constitutional');
	}
	if (typeof title !== 'string' || title.trim().length === 0) {
		error(400, 'Title is required');
	}
	if (title.length > TITLE_MAX) error(400, `Title must be ≤ ${TITLE_MAX} characters`);
	if (typeof proposalBody !== 'string' || proposalBody.trim().length === 0) {
		error(400, 'Body is required');
	}
	if (proposalBody.length > BODY_MAX) error(400, `Body must be ≤ ${BODY_MAX} characters`);

	let normalisedTags: string[] = [];
	if (Array.isArray(tags)) {
		const seen = new Set<string>();
		for (const raw of tags) {
			if (typeof raw !== 'string') continue;
			const norm = normaliseTag(raw);
			if (!norm) continue;
			if (seen.has(norm)) continue;
			seen.add(norm);
			normalisedTags.push(norm);
		}
		if (normalisedTags.length > TAG_MAX) error(400, `Maximum ${TAG_MAX} tags allowed`);
	}

	const config = TYPE_CONFIG[type];
	const periods = computePeriods(type);
	const choices = getChoices('default');
	const initialStatus = config.deliberationDays === 0 ? 'active' : 'deliberating';

	const [created] = await db
		.insert(proposals)
		.values({
			type,
			title: title.trim(),
			body: proposalBody,
			authorUserId: locals.user.id,
			tags: JSON.stringify(normalisedTags),
			choiceSetKey: 'default',
			choices: JSON.stringify(choices),
			threshold: config.threshold,
			voteOpensAt: periods.voteOpensAt,
			voteClosesAt: periods.voteClosesAt,
			ratificationEndsAt: periods.ratificationEndsAt,
			status: initialStatus
		})
		.returning();

	try {
		await sendDiscordMessage({
			content: newProposalMessage({
				title: created.title,
				type: created.type,
				authorName: locals.user.displayName || locals.user.name || 'A member'
			})
		});
	} catch (err) {
		votingLogger.error({ err, proposalId: created.id }, 'Discord notification failed');
	}

	votingLogger.info(
		{ proposalId: created.id, type: created.type, authorUserId: locals.user.id },
		'proposal created'
	);

	return json({ proposal: { ...created, votesByChoice: {}, votesTotal: 0, userHasVoted: false } });
};
