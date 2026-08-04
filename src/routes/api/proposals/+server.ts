import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { applications, proposals, proposalVotes } from '$lib/server/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { sendDiscordMessage } from '$lib/server/discord';
import { newProposalMessage } from '$lib/server/discord-templates';
import { votingLogger } from '$lib/server/logger';
import { computePeriods, isValidProposalType, TYPE_CONFIG } from '$lib/server/voting/periods';
import { getChoices } from '$lib/server/voting/choice-sets';
import { materialiseAllStale } from '$lib/server/voting/materialise';
import { checkRateLimit, PROPOSAL_CREATE_RATE_LIMIT } from '$lib/server/rateLimit';
import { getMembershipVisibility } from '$lib/server/membership-visibility';
import { requireCapability } from '$lib/server/membership';
import { recordParticipation } from '$lib/server/participation';

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

	// Non-admin members must not see membership votes tied to applications
	// submitted before their own (or their own). Non-membership proposals
	// (no linked application) are always visible.
	const vis = await getMembershipVisibility(locals);
	if (vis.restricted) {
		conditions.push(
			sql`(${proposals.linkedApplicationId} is null or ${proposals.linkedApplicationId} in (
				select ${applications.id} from ${applications}
				where ${applications.submittedAt} > ${vis.cutoff} and lower(${applications.email}) <> ${vis.email}))`
		);
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
			and(inArray(proposalVotes.proposalId, proposalIds), eq(proposalVotes.userId, locals.user.id))
		);
	const votedSet = new Set(userVotes.map((v) => v.proposalId));

	// For withdrawn proposals that link to an application, fetch the admin's
	// cancellation reason so the proposal detail view can show *why* it was
	// withdrawn. Single source of truth lives on the application row.
	const withdrawnAppIds = rows
		.filter((r) => r.status === 'withdrawn' && r.linkedApplicationId)
		.map((r) => r.linkedApplicationId as string);
	const withdrawalMap = new Map<string, { reason: string | null; at: string | null }>();
	if (withdrawnAppIds.length) {
		const appRows = await db
			.select({
				id: applications.id,
				cancellationReason: applications.cancellationReason,
				cancelledAt: applications.cancelledAt
			})
			.from(applications)
			.where(inArray(applications.id, withdrawnAppIds));
		for (const a of appRows) {
			withdrawalMap.set(a.id, { reason: a.cancellationReason, at: a.cancelledAt });
		}
	}

	let result = rows.map((row) => {
		const tallies = tallyMap.get(row.id) ?? {};
		const total = Object.values(tallies).reduce((a, b) => a + b, 0);
		const withdrawal =
			row.status === 'withdrawn' && row.linkedApplicationId
				? withdrawalMap.get(row.linkedApplicationId)
				: undefined;
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
			userHasVoted: votedSet.has(row.id),
			withdrawalReason: withdrawal?.reason ?? null,
			withdrawnAt: withdrawal?.at ?? null
		};
	});

	if (unvotedParam) {
		result = result.filter((r) => !r.userHasVoted && r.status === 'active');
	}

	return json({ proposals: result });
};

// POST /api/proposals — create a steward- or admin-authored proposal.
//
// Authorship is a role, not a level: members bring ideas through a Discord
// discussion and a steward carries the ones that fit the manifesto forward. The
// former Offcoin Level 3 gate is gone — it made authorship depend on a live
// Offcoin call that failed closed, so an outage silently removed the right.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireCapability('proposal.create', locals);

	if (!checkRateLimit(PROPOSAL_CREATE_RATE_LIMIT, locals.user.id)) {
		error(429, 'Too many proposals — please wait before creating another');
	}

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

	const normalisedTags: string[] = [];
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

	void recordParticipation(locals.user.id, 'proposal');

	return json({ proposal: { ...created, votesByChoice: {}, votesTotal: 0, userHasVoted: false } });
};
