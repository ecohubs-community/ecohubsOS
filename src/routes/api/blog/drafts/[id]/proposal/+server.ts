import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGhostDraft, updateGhostPostCustomFields } from '$lib/server/ghost';
import { createSystemProposal } from '$lib/server/voting/system-proposal';

// POST - Create a local voting proposal for a blog draft.
// Idempotent on linkedBlogDraftId: re-calling returns the existing proposal.
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not authenticated');

	const draftId = params.id;
	if (!draftId) error(400, 'Draft ID is required');

	const draft = await getGhostDraft(draftId);
	if (!draft) error(404, 'Draft not found');

	const siteUrl = 'https://ecohubs.community';
	const previewUrl = `${siteUrl}/blog/${draft.slug}`;
	const author = draft.authors?.[0]?.name || 'Unknown';
	const tagNames = draft.tags?.map((t) => t.name).join(', ') || 'None';
	const excerpt = draft.excerpt || draft.custom_excerpt || 'No excerpt provided.';

	const body = `## Blog Article Publication Proposal

**Title:** ${draft.title}

**Author:** ${author}

**Excerpt:**
${excerpt}

**Tags:** ${tagNames}

**Preview:** [View Draft](${previewUrl})

---

_Vote **Publish** to approve, **Reject** to decline, or **Needs Revision** if changes are required before publication._
`;

	const proposal = await createSystemProposal({
		type: 'operational',
		choiceSetKey: 'blog',
		tags: ['blog', 'system'],
		title: `Publish Blog Article: ${draft.title}`,
		body,
		linkedBlogDraftId: draftId
	});

	// Best-effort: store the local proposal id back on the Ghost draft so the
	// list endpoint can find it cheaply on next read.
	try {
		await updateGhostPostCustomFields(draftId, {
			ecohubsos_proposal_id: proposal.id
		});
	} catch {
		// Non-critical — the linkedBlogDraftId on the proposal row is the source of truth.
	}

	return json({ success: true, proposal });
};
