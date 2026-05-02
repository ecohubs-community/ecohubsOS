export const CHOICE_SETS = {
	default: ['For', 'Against', 'Needs Review'],
	membership: ['Approve', 'Reject', 'Needs Review'],
	blog: ['Publish', 'Reject', 'Needs Revision']
} as const;

export type ChoiceSetKey = keyof typeof CHOICE_SETS;

export function getChoices(key: ChoiceSetKey): readonly string[] {
	return CHOICE_SETS[key];
}

export function isValidChoiceSetKey(key: string): key is ChoiceSetKey {
	return key in CHOICE_SETS;
}
