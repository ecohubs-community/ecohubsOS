export type ProposalType = 'operational' | 'strategic' | 'constitutional';
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
	voters: VoterRow[];
}

export interface TagOption {
	tag: string;
	count: number;
}
