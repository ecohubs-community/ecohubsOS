import type { ProposalType } from '$lib/policy';

export type { ProposalType };

export type ProposalStatus =
	| 'deliberating'
	| 'active'
	| 'closed'
	| 'ratifying'
	| 'ratified'
	| 'withdrawn';
export type ProposalResult = 'approved' | 'rejected' | 'needs_review' | 'tied' | null;

export interface ProposalListRow {
	id: string;
	type: ProposalType;
	title: string;
	tags: string[];
	choiceSetKey: string;
	choices: string[];
	threshold: 'majority' | 'supermajority';
	status: ProposalStatus;
	result: ProposalResult;
	authorUserId: string | null;
	createdAt: string;
	voteOpensAt: string;
	voteClosesAt: string;
	ratificationEndsAt: string | null;
	linkedApplicationId: string | null;
	linkedBlogDraftId: string | null;
	votesByChoice: Record<string, number>;
	votesTotal: number;
	userHasVoted: boolean;
	// Populated only when status === 'withdrawn' and the proposal is linked
	// to an application that was cancelled by an admin.
	withdrawalReason?: string | null;
	withdrawnAt?: string | null;
}

export interface VoterRow {
	userId: string;
	displayName: string;
	choice: string;
	reason: string | null;
	votedAt: string;
}

export interface ProposalDetail extends ProposalListRow {
	body: string;
	/**
	 * The exact wording being agreed to, when the proposal carries one. `body`
	 * describes what the proposal is about; this is what a Yes ratifies.
	 */
	motion: string | null;
	voters: VoterRow[];
}

export interface TagOption {
	tag: string;
	count: number;
}
