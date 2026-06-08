export type Stage =
	| 'accepted'
	| 'reminder'
	| 'logged_in'
	| 'buddy_call'
	| 'complete'
	| 'standby'
	| 'dormant';

export interface OnboardingCard {
	id: string;
	email: string;
	fullName: string;
	applicationId: string | null;
	userId: string | null;
	stage: Stage;
	acceptedAt: string | null;
	lastLoginAt: string | null;
	reminderSentAt: string | null;
	buddyCallInvitedAt: string | null;
	buddyCallAt: string | null;
	buddyCallWith: string | null;
	buddyCallSkippedAt: string | null;
	dormantAt: string | null;
	standbyAt: string | null;
	standbyUntil: string | null;
	onboardingCompletedAt: string | null;
	avatarUrl: string | null;
	noteCount: number;
	daysSinceAccepted: number | null;
}

export interface OnboardingNote {
	id: string;
	text: string;
	createdBy: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface OnboardingEvent {
	id: string;
	type: string;
	detail: string | null;
	actor: string | null;
	createdAt: string | null;
}

export interface EmailTemplate {
	subject: string;
	body: string;
}

export interface OnboardingDetail {
	id: string;
	email: string;
	fullName: string;
	applicationId: string | null;
	userId: string | null;
	stage: Stage;
	acceptedAt: string | null;
	reminderSentAt: string | null;
	reminderSentBy: string | null;
	buddyCallInvitedAt: string | null;
	buddyCallInvitedBy: string | null;
	buddyCallAt: string | null;
	buddyCallWith: string | null;
	buddyCallSkippedAt: string | null;
	buddyCallSkippedBy: string | null;
	dormantAt: string | null;
	dormantBy: string | null;
	standbyAt: string | null;
	standbyBy: string | null;
	standbyUntil: string | null;
	onboardingCompletedAt: string | null;
	onboardingStartedAt: string | null;
	avatarUrl: string | null;
	notes: OnboardingNote[];
	events: OnboardingEvent[];
	buddyCallTemplate: EmailTemplate;
	senderName: string;
}

// `badgeClass` / `dotClass` hold full literal Tailwind classes — Tailwind only
// generates classes it can find as complete strings in source, so these must
// never be built dynamically.
export const STAGE_META: Record<
	Stage,
	{ label: string; hint: string; badgeClass: string; dotClass: string }
> = {
	accepted: {
		label: 'Accepted',
		hint: 'Welcome email sent',
		badgeClass: 'bg-sky-500/20 text-sky-300',
		dotClass: 'bg-sky-400'
	},
	reminder: {
		label: 'Reminder',
		hint: 'No login after 7 days',
		badgeClass: 'bg-amber-500/20 text-amber-300',
		dotClass: 'bg-amber-400'
	},
	logged_in: {
		label: 'Logged in',
		hint: 'Account active',
		badgeClass: 'bg-violet-500/20 text-violet-300',
		dotClass: 'bg-violet-400'
	},
	buddy_call: {
		label: 'Buddy call',
		hint: 'Invited / held',
		badgeClass: 'bg-teal-500/20 text-teal-300',
		dotClass: 'bg-teal-400'
	},
	complete: {
		label: 'Complete',
		hint: 'Onboarding done',
		badgeClass: 'bg-emerald-500/20 text-emerald-300',
		dotClass: 'bg-emerald-400'
	},
	standby: {
		label: 'Standby',
		hint: 'Paused — will return',
		badgeClass: 'bg-indigo-500/20 text-indigo-300',
		dotClass: 'bg-indigo-400'
	},
	dormant: {
		label: 'No response',
		hint: 'Set aside — never engaged',
		badgeClass: 'bg-slate-500/20 text-slate-300',
		dotClass: 'bg-slate-400'
	}
};

export const STAGE_ORDER: Stage[] = [
	'accepted',
	'reminder',
	'logged_in',
	'buddy_call',
	'complete',
	'standby',
	'dormant'
];

/** True when an on-standby card's follow-up date has arrived (time to check in). */
export function standbyFollowUpDue(
	stage: Stage,
	standbyUntil: string | null | undefined
): boolean {
	if (stage !== 'standby' || !standbyUntil) return false;
	const d = new Date(standbyUntil);
	return !Number.isNaN(d.getTime()) && d.getTime() <= Date.now();
}

/** Format an ISO date as a short local date, or a fallback. */
export function fmtDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Relative "x days ago" style used across the existing apps. */
export function fmtRelative(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
	if (diffDays <= 0) return 'Today';
	if (diffDays === 1) return 'Yesterday';
	if (diffDays < 7) return `${diffDays} days ago`;
	return d.toLocaleDateString();
}
