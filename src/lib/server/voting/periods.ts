export type ProposalType = 'operational' | 'strategic' | 'constitutional';
export type Threshold = 'majority' | 'supermajority';

export interface TypeConfig {
	deliberationDays: number;
	voteDays: number;
	threshold: Threshold;
	ratificationDays: number;
}

export const TYPE_CONFIG: Record<ProposalType, TypeConfig> = {
	operational: { deliberationDays: 0, voteDays: 3, threshold: 'majority', ratificationDays: 0 },
	strategic: { deliberationDays: 5, voteDays: 7, threshold: 'majority', ratificationDays: 0 },
	constitutional: {
		deliberationDays: 15,
		voteDays: 14,
		threshold: 'supermajority',
		ratificationDays: 30
	}
};

export interface ProposalPeriods {
	voteOpensAt: Date;
	voteClosesAt: Date;
	ratificationEndsAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computePeriods(type: ProposalType, now: Date = new Date()): ProposalPeriods {
	const config = TYPE_CONFIG[type];
	const voteOpensAt = new Date(now.getTime() + config.deliberationDays * DAY_MS);
	const voteClosesAt = new Date(voteOpensAt.getTime() + config.voteDays * DAY_MS);
	const ratificationEndsAt =
		config.ratificationDays > 0
			? new Date(voteClosesAt.getTime() + config.ratificationDays * DAY_MS)
			: null;
	return { voteOpensAt, voteClosesAt, ratificationEndsAt };
}

export function isValidProposalType(type: string): type is ProposalType {
	return type in TYPE_CONFIG;
}
