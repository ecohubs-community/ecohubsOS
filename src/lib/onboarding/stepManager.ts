export type ActionType = 'url' | 'email' | 'none';

export interface SubStepAction {
	type: ActionType;
	url?: string;
	email?: {
		to: string | string[];
		subject: string;
		html: string;
		text: string;
		replyTo?: string;
	};
}

export interface SubStep {
	id: string;
	title: string;
	actions: SubStepAction[];
	completed?: boolean;
}

export interface Step {
	id: string;
	title: string;
	subSteps?: SubStep[];
	url?: string;
	email?: SubStepAction['email'];
	completed?: boolean;
}

const STORAGE_KEY = 'onboarding-steps';

export function createDefaultSteps(): Step[] {
	return [
		{
			id: 'discord',
			title: 'Join Private Discord Channel',
			subSteps: [
				{
					id: 'discord-request',
					title: 'Request Access',
					actions: [
						{
							type: 'email',
							email: {
								to: 'admin@ecohubs.community',
								subject: 'Discord Access Request',
								text: 'Please grant me access to the private Discord channel.',
								html: '<p>Please grant me access to the private Discord channel.</p>'
							}
						}
					]
				},
				{
					id: 'discord-join',
					title: 'Join Channel',
					actions: [{ type: 'none' }]
				},
				{
					id: 'discord-introduce',
					title: 'Introduce yourself in the channel',
					actions: [{ type: 'none' }]
				}
			]
		},
		{
			id: 'discussions',
			title: 'Discover Discussions Forum',
			subSteps: [
				{
					id: 'forum-request',
					title: 'Request Account',
					actions: [
						{
							type: 'email',
							email: {
								to: 'admin@ecohubs.community',
								subject: 'Discussions Forum Account Request',
								text: 'Please create my forum account and send credentials.',
								html: '<p>Please create my forum account and send credentials.</p>'
							}
						}
					]
				},
				{
					id: 'forum-login',
					title: 'Login to Discussions Forum',
					actions: [{ type: 'url', url: 'https://discussions.ecohubs.community/' }]
				},
				{
					id: 'forum-read-latest',
					title: 'Read latest discussions',
					actions: [{ type: 'none' }]
				},
				{
					id: 'forum-howto-create',
					title: 'Find out how to create new discussions',
					actions: [{ type: 'none' }]
				}
			]
		},
		{
			id: 'admin-login',
			title: 'Login with wallet at Admin area',
			url: 'https://ecohubs.community/admin'
		},
		{
			id: 'snapshot',
			title: 'Snapshot Voting',
			subSteps: [
				{
					id: 'snapshot-request-rights',
					title: 'Request Snapshot Voting rights',
					actions: [
						{
							type: 'email',
							email: {
								to: 'admin@ecohubs.community',
								subject: 'Snapshot Voting Rights Request',
								text: 'Please add my wallet ID to multisig and grant voting rights in Snapshot.',
								html: '<p>Please add my wallet ID to multisig and grant voting rights in Snapshot.</p>'
							}
						}
					]
				},
				{
					id: 'snapshot-open',
					title: 'Open snapshot space',
					actions: [{ type: 'url', url: 'https://snapshot.org/#/s:ecohubs.eth' }]
				},
				{
					id: 'snapshot-read',
					title: 'Read current proposals',
					actions: [{ type: 'none' }]
				},
				{
					id: 'snapshot-vote',
					title: 'Vote for a proposal',
					actions: [{ type: 'none' }]
				}
			]
		}
	];
}

export function loadSteps(): Step[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return createDefaultSteps();
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : createDefaultSteps();
	} catch {
		return createDefaultSteps();
	}
}

export function saveSteps(steps: Step[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
	} catch {
		// ignore
	}
}

export function isSubStepEnabled(step: Step, subIndex: number): boolean {
	if (!step.subSteps || subIndex < 0 || subIndex >= step.subSteps.length) return false;
	if (subIndex === 0) return true;
	// enabled only if previous sub-step completed
	return !!step.subSteps[subIndex - 1].completed;
}

export function markSubStepCompleted(steps: Step[], stepId: string, subId: string): Step[] {
	const next = steps.map((s) => {
		if (s.id !== stepId) return s;
		if (!s.subSteps) return s;
		const updatedSubs = s.subSteps.map((sub) =>
			sub.id === subId ? { ...sub, completed: true } : sub
		);
		const allDone = updatedSubs.every((sub) => sub.completed);
		return { ...s, subSteps: updatedSubs, completed: allDone };
	});
	saveSteps(next);
	return next;
}

export function markStepCompleted(steps: Step[], stepId: string): Step[] {
	const next = steps.map((s) => (s.id === stepId ? { ...s, completed: true } : s));
	saveSteps(next);
	return next;
}

export function getActionButton(sub: SubStep): { label: string; type: ActionType } | null {
	if (!sub.actions || sub.actions.length === 0) return null;
	const action = sub.actions[0];
	if (action.type === 'url') return { label: 'Open Site', type: 'url' };
	if (action.type === 'email') return { label: 'Request', type: 'email' };
	if (action.type === 'none') return { label: 'Mark Done', type: 'none' };
	return null;
}

export async function performAction(sub: SubStep): Promise<'done' | 'error' | 'none'> {
	const action = sub.actions[0];
	if (!action) return 'none';
	if (action.type === 'url' && action.url) {
		try {
			window.open(action.url, '_blank', 'noopener,noreferrer');
			return 'done';
		} catch {
			return 'error';
		}
	}
	if (action.type === 'email' && action.email) {
		try {
			const res = await fetch('/api/onboarding/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(action.email)
			});
			if (!res.ok) return 'error';
			return 'done';
		} catch {
			return 'error';
		}
	}
	if (action.type === 'none') {
		return 'done';
	}
	return 'none';
}
