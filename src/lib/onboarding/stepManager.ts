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
	/**
	 * When true, the substep can be skipped (a "Skip" button appears
	 * alongside the action button). Skipping marks the substep as
	 * complete without performing the action, so the parent step can
	 * roll up to completed and the wizard can advance.
	 */
	optional?: boolean;
}

export interface Step {
	id: string;
	title: string;
	/**
	 * Short label used in the mobile horizontal stepper. Falls back to
	 * the first word of `title` if absent — but the auto-fallback
	 * usually produces useless results ("Set", "Create", "Connect"),
	 * so set this explicitly for any user-facing step.
	 */
	shortTitle?: string;
	/**
	 * Plain-language explainer rendered under the step title. Aimed at
	 * a new member who has never heard of the tool/concept the step
	 * introduces. Keep to 2-3 sentences.
	 */
	description?: string;
	/**
	 * Iconify name used in the wizard sidebar + step title pill.
	 * Couples the icon to the step semantic rather than its index in
	 * the default list, which moves around as the flow evolves.
	 */
	icon?: string;
	subSteps?: SubStep[];
	url?: string;
	email?: SubStepAction['email'];
	completed?: boolean;
}

const STORAGE_KEY = 'onboarding-steps';

export function createDefaultSteps(): Step[] {
	return [
		// Manifesto step is rendered inline by OnboardingWizard
		// (special-cased on step.id === 'manifesto'). Its substep has no
		// actions because the sign UX (scroll-to-end + hold-to-sign) lives
		// inside the inline component.
		{
			id: 'manifesto',
			title: 'Sign the EcoHubs Manifesto',
			shortTitle: 'Manifesto',
			icon: 'tabler:writing-sign',
			description:
				`Read the EcoHubs Manifesto and sign it to confirm you share its values. The
				 manifesto is the shared foundation every member commits to before joining
				 the community.`,
			subSteps: [
				{
					id: 'manifesto-sign',
					title: 'Read & sign the manifesto',
					actions: []
				}
			]
		},
		// Wallet & Safe membership are now optional — users opt in via the
		// "Safe Membership" system app from the dock. Voting happens inside
		// ecohubsOS and no longer requires a Snapshot account, so the old
		// Snapshot onboarding step has also been dropped.
		// The profile step is rendered inline by OnboardingWizard
		// (special-cased on step.id === 'profile'). We keep a single
		// substep so the existing step.completed roll-up logic (which
		// powers canGoNext / frontier) keeps working — but its `actions`
		// is empty because the form is right there in the step body.
		{
			id: 'profile',
			title: 'Set up your profile',
			shortTitle: 'Profile',
			icon: 'tabler:user-circle',
			description:
				`Tell other members a bit about you. We've pre-filled some fields from your application —
				 feel free to edit them, or skip and finish later. Add a photo, bio, where you are, 
				 and how you want to contribute. Other members see this when you vote, comment, or claim tasks. 
				 Optional — you can skip and finish later from the My Profile app.`,
			subSteps: [
				{
					id: 'profile-setup',
					title: 'Profile details',
					actions: [],
					optional: true
				}
			]
		},
		{
			id: 'puckstack',
			title: 'Create Puckstack Account',
			shortTitle: 'Puckstack',
			icon: 'tabler:checklist',
			description:
				"Puckstack is a separate platform that ecohubs uses to organise community work. Tasks you take on (e.g. writing an article, helping with infrastructure, etc.) are tracked there and earn you XP and ECO tokens, which determine your member level over time and unlocks permissions in puckstack as well as in ecohubsOS. You'll create a free Puckstack account in the next step — sign in with Google or GitHub, no separate password.",
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
			shortTitle: 'Discord',
			icon: 'tabler:brand-discord',
			description:
				"Discord is a free chat app the ecohubs community uses for day-to-day conversation, announcements, and quick questions. Connecting it links your ecohubsOS account to the Discord server so you get the member-only channels and can chat with people directly. If you don't have Discord yet, you'll create a free account when you connect.",
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
		// Removed steps:
		//  - `discussions` (forum-login / forum-read-latest /
		//    forum-howto-create): the discussions forum isn't in active
		//    use yet.
		//  - `voting` (voting-open / voting-read / voting-vote): the
		//    voting app is one entry in the dock — members discover it
		//    naturally without an onboarding nudge.
	];
}

/**
 * Substep ids the *current* default flow actually has the user complete.
 * Derived from createDefaultSteps() so it stays in sync as the flow evolves.
 * Single source of truth for "is onboarding done" checks — used by the
 * completion gate (/api/onboarding/complete) and the admin members status.
 */
export function requiredSubstepIds(): string[] {
	const ids: string[] = [];
	for (const step of createDefaultSteps()) {
		for (const sub of step.subSteps ?? []) {
			ids.push(sub.id);
		}
	}
	return ids;
}

/**
 * Substeps that are part of the flow but do NOT block "onboarding complete"
 * for admin-status / backfill purposes. The "Introduce yourself" step is a
 * soft, self-attested action many members skip after connecting Discord, so
 * it shouldn't keep an otherwise-finished member stuck on "In Progress".
 * (The in-app wizard completion gate still uses the full requiredSubstepIds.)
 */
export const COMPLETION_OPTIONAL_SUBSTEP_IDS = ['discord-introduce'] as const;

/**
 * Substep ids that actually gate completion for admin status + backfill:
 * requiredSubstepIds() minus the soft, non-blocking ones above.
 */
export function completionRequiredSubstepIds(): string[] {
	const skip = new Set<string>(COMPLETION_OPTIONAL_SUBSTEP_IDS);
	return requiredSubstepIds().filter((id) => !skip.has(id));
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
	'puckstack-copy-id',
	'forum-login',
	'forum-read-latest',
	'forum-howto-create',
	'voting-open',
	'voting-read',
	'voting-vote'
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
