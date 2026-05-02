import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

// GET /api/proposals/tags — distinct tags with usage counts.
// Uses SQLite's json_each to flatten the tags JSON arrays.
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const result = (await db.all(sql`
		select je.value as tag, count(*) as n
		from proposals p, json_each(p.tags) je
		group by je.value
		order by n desc
	`)) as Array<{ tag: string; n: number }>;

	return json({
		tags: result.map((r) => ({ tag: String(r.tag), count: Number(r.n) }))
	});
};
