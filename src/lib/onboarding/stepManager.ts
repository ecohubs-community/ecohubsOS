export type OnboardingProgress = Record<string, string>;

export type ActionType = 'url' | 'email' | 'none' | 'app' | 'discord';

export interface SubStepAction {
	type: ActionType;
	url?: string;
	appId?: string; // For 'app' type - opens an internal app in ecohubsOS
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
		// Wallet & Safe membership are now optional — users opt in via the
		// "Safe Membership" system app from the dock. Voting happens inside
		// ecohubsOS and no longer requires a Snapshot account, so the old
		// Snapshot onboarding step has also been dropped.
		{
			id: 'puckstack',
			title: 'Create Puckstack Account',
			subSteps: [
				{
					id: 'puckstack-signup',
					title: 'Sign up for Puckstack',
					actions: [{ type: 'app', appId: 'puckstack-signup' }]
				}
				// `puckstack-copy-id` retired — the PuckstackSignup app now
				// captures the Puckstack User ID server-side via the
				// /invitations/auto-generate response and persists it to
				// `users.puckstackUserId` automatically.
				//
				// `offcoin-connect` retired — at this point in onboarding the
				// user has no wallet connected, so linking a wallet to
				// Offcoin can't succeed. Wallet/Offcoin linking is handled
				// later via the opt-in Wallet & Safe system apps.
			]
		},
		{
			id: 'discord',
			title: 'Connect Discord & Join Community',
			subSteps: [
				{
					id: 'discord-connect',
					title: 'Connect your Discord account',
					actions: [{ type: 'discord' }]
				},
				{
					id: 'discord-introduce',
					title: 'Introduce yourself in the community',
					actions: [{ type: 'none' }]
				}
			]
		},
		{
			id: 'discussions',
			title: 'Discover Discussions Forum',
			subSteps: [
				// {
				// 	id: 'forum-request',
				// 	title: 'Create Forum Account',
				// 	actions: [{ type: 'app', appId: 'flarum-connect' }]
				// },
				{
					id: 'forum-login',
					title: 'Login to Discussions Forum',
					actions: [{ type: 'url', url: 'https://discussions.ecohubs.community/' }]
				},
				{
					id: 'forum-read-latest',
					title: 'Introduce yourself in the forum',
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
			id: 'voting',
			title: 'Voting & Governance',
			subSteps: [
				{
					id: 'voting-open',
					title: 'Open the Voting app',
					actions: [{ type: 'app', appId: 'voting' }]
				},
				{
					id: 'voting-read',
					title: 'Read current proposals',
					actions: [{ type: 'none' }]
				},
				{
					id: 'voting-vote',
					title: 'Vote on a proposal',
					actions: [{ type: 'none' }]
				}
			]
		}
	];
}

// Substep ids that the onboarding step manager used to ship and that
// existing users may still have stored in their progress record. Used
// during migration so removing them doesn't visibly regress completion %.
export const RETIRED_SUBSTEP_IDS = [
	'wallet-setup',
	'wallet-connect',
	'safe-proposal',
	'snapshot-open',
	'snapshot-read',
	'snapshot-vote',
	'snapshot-request-rights',
	'offcoin-connect',
	'puckstack-copy-id'
] as const;

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
	// Fire-and-forget sync to server
	syncStepToServer(subId);
	return next;
}

export function markStepCompleted(steps: Step[], stepId: string): Step[] {
	const next = steps.map((s) => (s.id === stepId ? { ...s, completed: true } : s));
	saveSteps(next);
	return next;
}

/**
 * Mark a substep as completed by its ID (searches all steps)
 * Useful for app actions that complete asynchronously
 */
export function markSubStepCompletedById(subStepId: string): void {
	const steps = loadSteps();
	for (const step of steps) {
		if (!step.subSteps) continue;
		const subStep = step.subSteps.find((s) => s.id === subStepId);
		if (subStep) {
			// markSubStepCompleted already calls saveSteps + syncStepToServer
			markSubStepCompleted(steps, step.id, subStepId);
			// Dispatch custom event so OnboardingCard can update its state
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('onboarding-step-completed', {
					detail: { stepId: step.id, subStepId }
				}));
			}
			return;
		}
	}
}

// --- Server sync utilities ---

/**
 * Apply server progress onto a fresh Step[] tree.
 * Marks substeps as completed if their ID exists in the progress record.
 */
export function applyProgress(steps: Step[], progress: OnboardingProgress): Step[] {
	return steps.map((step) => {
		if (!step.subSteps) return step;
		const updatedSubs = step.subSteps.map((sub) => ({
			...sub,
			completed: sub.completed || !!progress[sub.id]
		}));
		const allDone = updatedSubs.every((sub) => sub.completed);
		return { ...step, subSteps: updatedSubs, completed: allDone };
	});
}

/**
 * Extract completed substep IDs from a Step[] tree as a progress record.
 */
export function extractProgress(steps: Step[]): OnboardingProgress {
	const progress: OnboardingProgress = {};
	for (const step of steps) {
		if (!step.subSteps) continue;
		for (const sub of step.subSteps) {
			if (sub.completed) {
				progress[sub.id] = new Date().toISOString();
			}
		}
	}
	return progress;
}

/**
 * Fire-and-forget sync of a single substep completion to the server.
 * localStorage remains the immediate cache; server is the persistent store.
 */
export async function syncStepToServer(subStepId: string): Promise<void> {
	try {
		await fetch('/api/onboarding/progress', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				completedSteps: { [subStepId]: new Date().toISOString() }
			})
		});
	} catch {
		// Silently fail — localStorage is the immediate cache,
		// server will be synced on next full load
	}
}

export function getActionButton(sub: SubStep): { label: string; type: ActionType; appId?: string } | null {
	if (!sub.actions || sub.actions.length === 0) return null;
	const action = sub.actions[0];
	if (action.type === 'url') return { label: 'Open Site', type: 'url' };
	if (action.type === 'email') return { label: 'Request', type: 'email' };
	if (action.type === 'app') return { label: 'Open', type: 'app', appId: action.appId };
	if (action.type === 'discord') return { label: 'Connect', type: 'discord' };
	if (action.type === 'none') return { label: 'Mark Done', type: 'none' };
	return null;
}

/**
 * Perform an action for a sub-step
 * Note: 'app' type actions should be handled by the UI component (opens app in ecohubsOS)
 * This function returns 'app' for app actions so the caller can handle opening the app
 */
export async function performAction(sub: SubStep): Promise<'done' | 'error' | 'none' | 'app' | 'discord'> {
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
	if (action.type === 'app') {
		// Return 'app' so the caller can handle opening the app via os.openApp()
		return 'app';
	}
	if (action.type === 'discord') {
		// Return 'discord' so the caller can handle fetching the invite link
		return 'discord';
	}
	if (action.type === 'none') {
		return 'done';
	}
	return 'none';
}
