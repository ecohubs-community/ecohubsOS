import type { applications } from '$lib/server/db/schema';

type Application = typeof applications.$inferSelect;

/**
 * Render a membership application as the body of a system-authored proposal.
 * Best-effort: if formData JSON cannot be parsed, falls back to whatever
 * structured fields we know from the row.
 */
export function formatApplicationBody(app: Application): string {
	let formData: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(app.formData);
		if (parsed && typeof parsed === 'object') formData = parsed as Record<string, unknown>;
	} catch {
		// formData may be malformed for old rows — proceed with empty.
	}

	const fields: Array<[string, unknown]> = [
		['Full name', app.fullName],
		['Email', app.email],
		['Location', formData.location],
		['Languages', formData.languages],
		['Bio', formData.bio],
		['Contribution', formData.contribution],
		['Motivation', formData.motivation]
	];

	const lines: string[] = ['## Membership Application', ''];
	for (const [label, raw] of fields) {
		if (raw === undefined || raw === null) continue;
		const value = String(raw).trim();
		if (!value) continue;
		if (value.length > 80 || value.includes('\n')) {
			lines.push(`**${label}:**`, '', value, '');
		} else {
			lines.push(`**${label}:** ${value}`);
		}
	}

	lines.push(
		'',
		'---',
		'',
		'_Vote **Approve** to accept the application, **Reject** to decline, or **Needs Review** if more information is required._'
	);

	return lines.join('\n');
}
