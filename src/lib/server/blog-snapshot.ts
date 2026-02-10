import { env } from '$env/dynamic/private';
import type { GhostDraft } from './ghost';

const SNAPSHOT_SPACE = env.SNAPSHOT_SPACE || '';

const SNAPSHOT_API_URL = 'https://hub.snapshot.org/graphql';

export interface ProposalStatus {
	status: 'active' | 'closed';
	end: number;
	scores: { [choice: string]: number };
	choices: string[];
}

/**
 * Query Snapshot GraphQL API
 */
async function querySnapshot(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
	try {
		const response = await fetch(SNAPSHOT_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query,
				variables
			})
		});

		const result = await response.json();

		if (result.errors) {
			console.error('Snapshot API error:', result.errors);
			return null;
		}

		return result.data;
	} catch (error) {
		console.error('Error querying Snapshot API:', error);
		return null;
	}
}

/**
 * Find Snapshot proposal for a blog draft by title pattern
 */
export async function getProposalForDraft(
	draftTitle: string,
	_draftSlug: string
): Promise<string | null> {
	if (!SNAPSHOT_SPACE) {
		return null;
	}

	try {
		const query = `
			query GetProposals($space: String!, $title: String!) {
				proposals(
					first: 1,
					where: {
						space: $space,
						title_contains: $title
					},
					orderBy: "created",
					orderDirection: desc
				) {
					id
					title
				}
			}
		`;

		const data = (await querySnapshot(query, {
			space: SNAPSHOT_SPACE,
			title: draftTitle // Search for draft title in proposal title
		})) as { proposals?: Array<{ id: string; title: string }> } | null;

		if (data?.proposals && data.proposals.length > 0) {
			// Check if proposal title matches our pattern
			const proposal = data.proposals.find((p) =>
				p.title.includes(`Publish Blog Article: ${draftTitle}`)
			);

			return proposal?.id || null;
		}

		return null;
	} catch (error) {
		console.error('Error finding proposal for draft:', error);
		return null;
	}
}

/**
 * Get proposal status and voting results
 */
export async function getProposalStatus(proposalId: string): Promise<ProposalStatus | null> {
	if (!SNAPSHOT_SPACE) {
		return null;
	}

	try {
		const query = `
			query GetProposal($id: String!) {
				proposal(id: $id) {
					id
					state
					end
					scores
					choices
				}
			}
		`;

		const data = (await querySnapshot(query, { id: proposalId })) as {
			proposal?: {
				id: string;
				state: string;
				end: number;
				scores: number[];
				choices: string[];
			};
		} | null;

		if (!data?.proposal) {
			return null;
		}

		const proposal = data.proposal;
		const now = Math.floor(Date.now() / 1000);
		const isActive = proposal.state === 'active' && proposal.end > now;

		return {
			status: isActive ? 'active' : 'closed',
			end: proposal.end,
			scores: proposal.scores as unknown as { [choice: string]: number },
			choices: proposal.choices || []
		};
	} catch (error) {
		console.error('Error getting proposal status:', error);
		return null;
	}
}

/**
 * Check if proposal is approved (Publish choice won)
 */
export async function isProposalApproved(proposalId: string): Promise<boolean> {
	const status = await getProposalStatus(proposalId);

	if (!status || status.status !== 'closed') {
		return false;
	}

	// Check if "Publish" choice has the highest score
	const publishScore =
		(status.scores as unknown as Record<string, number>)['Publish'] ||
		(status.scores as unknown as Record<string, number>)['0'] ||
		0;
	const rejectScore =
		(status.scores as unknown as Record<string, number>)['Reject'] ||
		(status.scores as unknown as Record<string, number>)['1'] ||
		0;
	const needsRevisionScore =
		(status.scores as unknown as Record<string, number>)['Needs Revision'] ||
		(status.scores as unknown as Record<string, number>)['2'] ||
		0;

	// Publish wins if it has the highest score
	return publishScore > rejectScore && publishScore > needsRevisionScore;
}

/**
 * Determine the voting result for a membership application proposal.
 * Membership proposals use choices: ['Approve', 'Reject', 'Needs Review']
 * Returns the winning choice as a lowercase key, or null if vote is still active.
 */
export function getMembershipVotingResult(
	status: ProposalStatus
): 'approved' | 'rejected' | 'needs_review' | null {
	if (status.status !== 'closed') return null;

	const scores = status.scores as unknown as number[];
	if (!scores || scores.length === 0) return null;

	const maxScore = Math.max(...scores);
	if (maxScore === 0) return null;

	const maxIndex = scores.indexOf(maxScore);

	switch (maxIndex) {
		case 0:
			return 'approved';
		case 1:
			return 'rejected';
		case 2:
			return 'needs_review';
		default:
			return null;
	}
}

/**
 * Format draft data for Snapshot proposal body
 */
export function formatDraftForSnapshot(draft: GhostDraft): string {
	const siteUrl = 'https://ecohubs.community';
	const previewUrl = `${siteUrl}/blog/${draft.slug}`;

	return `## Blog Article Publication Proposal

**Title:** ${draft.title}

**Author:** ${draft.authors?.[0]?.name || 'Unknown'}

**Excerpt:**
${draft.excerpt || draft.custom_excerpt || 'No excerpt provided.'}

**Tags:** ${draft.tags?.map((t) => t.name).join(', ') || 'None'}

**Preview:** [View Draft](${previewUrl})

---

**Note:** This proposal is for publishing a blog article draft. Vote "Publish" to approve, "Reject" to decline, or "Needs Revision" if changes are required before publication.

*Created: ${new Date(draft.updated_at).toLocaleString()}*
`;
}
