/**
 * Membership policy — the single source of truth for every gate in the OS.
 *
 * Deliberately isomorphic: no `$lib/server` imports, no DB, no fetch, no
 * environment access. The server enforces from this module and the client
 * *explains* from it. Two copies of the number "level 1" is how the UI ends up
 * lying to members about what unlocks when.
 *
 * Server-side enforcement (throwing 401/403) belongs in
 * `$lib/server/membership.ts`. This module only decides and describes.
 *
 * The model is one **status** × three **roles**:
 *
 *   role   (Authentik)  none (= trial) | EcoHubs Member | EcoHubs Steward | EcoHubs Admin
 *   status (DB)         active | standby | exited
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Authentik group names for the three defined roles.
 *
 * "Trial" is deliberately absent — a trial member is someone holding NONE of
 * these groups. There is no trial state to provision, backfill, or keep in sync,
 * and role/status can never contradict each other.
 */
export const ROLE_GROUPS = {
	member: 'EcoHubs Member',
	steward: 'EcoHubs Steward',
	admin: 'EcoHubs Admin'
} as const;

export type Role = 'trial' | 'member' | 'steward' | 'admin';

export type MembershipStatus = 'active' | 'standby' | 'exited';

/**
 * Ascending authority. Roles are **additive**: a steward also holds the Member
 * group, so voting rights follow from Member rather than being re-granted per
 * role, and dropping Steward leaves a working active member behind.
 */
const ROLE_RANK: Record<Role, number> = { trial: 0, member: 1, steward: 2, admin: 3 };

export function roleRank(role: Role): number {
	return ROLE_RANK[role];
}

export function isAtLeastRole(role: Role, minimum: Role): boolean {
	return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Parse the JSON-encoded group list stored on `user.groups`.
 *
 * Returns `[]` for null or malformed input — a member with unreadable groups
 * resolves to `trial`, which denies rather than grants.
 */
export function parseGroupsJson(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Highest role implied by a set of Authentik group names. Unknown groups are
 * ignored, so grant groups (see `GRANT_GROUPS`) can live in the same list.
 */
export function resolveRole(groups: readonly string[]): Role {
	if (groups.includes(ROLE_GROUPS.admin)) return 'admin';
	if (groups.includes(ROLE_GROUPS.steward)) return 'steward';
	if (groups.includes(ROLE_GROUPS.member)) return 'member';
	return 'trial';
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Additive Authentik groups granted on request — the model for the plan's
 * "can request access to blog & newsletter writing, social media posting".
 * Each tool is requested independently.
 */
export const GRANT_GROUPS = {
	blog: 'EcoHubs Blog',
	newsletter: 'EcoHubs Newsletter',
	blueprint: 'EcoHubs Blueprint',
	social: 'EcoHubs Social'
} as const;

/** Everything gateable in the OS. One entry per thing a member can or cannot do. */
export type Capability =
	| 'os.access'
	| 'voting.view'
	| 'proposal.vote'
	| 'proposal.create'
	| 'blog.write'
	| 'newsletter.write'
	| 'blueprint.admin'
	| 'social.post'
	| 'buddy.host'
	| 'rewards.grant'
	| 'onboarding.manage'
	| 'membership.exit'
	| 'admin.apps';

export interface CapabilitySpec {
	/**
	 * Member-facing noun phrase used to build explanations. Written so that
	 * `` `${label} is …` `` reads naturally.
	 */
	readonly label: string;
	readonly minRole: Role;
	readonly statuses: readonly MembershipStatus[];
	/**
	 * Additive group required *on top of* `minRole`. Its absence is what makes
	 * an app render locked-with-a-request-button rather than disappearing.
	 */
	readonly grant?: string;
}

export const CAPABILITIES: Record<Capability, CapabilitySpec> = {
	// Standby members keep access so they have a route in to request
	// reactivation — but the shell they get is the gated reactivation screen,
	// not the desktop. See specs/membership-levels-roadmap.md §7.
	'os.access': {
		label: 'EcoHubs OS',
		minRole: 'trial',
		statuses: ['active', 'standby']
	},
	// Trial members see the Voting app read-only: they watch the community
	// decide, they just cannot vote or propose.
	'voting.view': { label: 'The Voting app', minRole: 'trial', statuses: ['active'] },
	'proposal.vote': { label: 'Voting', minRole: 'member', statuses: ['active'] },
	'proposal.create': { label: 'Creating proposals', minRole: 'steward', statuses: ['active'] },

	'blog.write': {
		label: 'Blog writing',
		minRole: 'member',
		statuses: ['active'],
		grant: GRANT_GROUPS.blog
	},
	'newsletter.write': {
		label: 'Newsletter writing',
		minRole: 'member',
		statuses: ['active'],
		grant: GRANT_GROUPS.newsletter
	},
	'blueprint.admin': {
		label: 'Blueprint admin access',
		minRole: 'member',
		statuses: ['active'],
		grant: GRANT_GROUPS.blueprint
	},
	'social.post': {
		label: 'Social media posting',
		minRole: 'member',
		statuses: ['active'],
		grant: GRANT_GROUPS.social
	},

	'buddy.host': { label: 'Hosting buddy calls', minRole: 'member', statuses: ['active'] },
	'rewards.grant': { label: 'Granting rewards', minRole: 'steward', statuses: ['active'] },
	'onboarding.manage': {
		label: 'The Member Onboarding app',
		minRole: 'steward',
		statuses: ['active']
	},
	'membership.exit': { label: 'Exiting members', minRole: 'steward', statuses: ['active'] },
	'admin.apps': { label: 'Admin apps', minRole: 'admin', statuses: ['active'] }
};

// ---------------------------------------------------------------------------
// The tuning surface
// ---------------------------------------------------------------------------

/**
 * Every threshold in one place. We are still learning which levels work for
 * what, so changing a number here must be enough to move the whole OS —
 * enforcement, UI copy, and unlock hints alike.
 */
export const POLICY = {
	levels: {
		/** trial → member. Applied automatically on the Offcoin level-up webhook. */
		memberFromLevel: 1,
		/** Eligibility to *request* steward. Never automatic — request + approval. */
		stewardMinLevel: 3,
		adminMinLevel: 3
	},

	/** Inactivity timers, in days. Downgrades are only ever *proposed* to a human. */
	timers: {
		trialToStandby: 90,
		standbyToExited: 365,
		memberToExited: 365,
		warnBeforeDays: [14, 7] as readonly number[]
	},

	/** Reward-granting guardrails — XP grants are a privilege-escalation path. */
	grants: {
		maxXpPerGrant: 100,
		/** Same cap for stewards and admins. */
		maxXpPerActorPerDay: 500,
		maxEcoPerGrant: 500,
		allowSelfGrant: false,
		/** Offcoin has no `subtractXp` at all; ECO deductions are policy-blocked too. */
		allowNegative: false
	},

	/** Reactivation from standby. */
	reactivation: {
		/**
		 * `operational` is already exactly a 3-day majority vote with no
		 * deliberation and no ratification phase — no new voting config needed.
		 */
		proposalType: 'operational',
		cooldownDays: 30,
		/**
		 * Override of the normal resolver, which treats zero votes as `rejected`
		 * ("no mandate; status quo holds"). Correct for a policy proposal, wrong
		 * for a person: silence must not refuse a member who did nothing wrong.
		 */
		zeroVotesResult: 'needs_review' as const,
		/** A rejected member is never told the voters' reasons. */
		discloseVoterReasons: false
	},

	capabilities: CAPABILITIES
} as const;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface MemberContext {
	/** Raw Authentik group names, as stored in `user.groups`. */
	groups: readonly string[];
	status: MembershipStatus;
	/**
	 * Offcoin level. Must be the snapshot-backed value, never a live read at
	 * gate time — an Offcoin outage must not silently demote the community.
	 */
	level: number;
}

export type DenyReason = 'needs_role' | 'needs_status' | 'needs_grant';

/**
 * How a *locked app* should surface. This governs the app grid and dock only —
 * in-app affordances (a disabled vote button) should always explain themselves
 * with `message`, which is the whole point of returning a reason rather than a
 * boolean.
 */
export type AppVisibility = 'hidden' | 'locked';

export interface CapabilityGranted {
	allowed: true;
}

export interface CapabilityDenied {
	allowed: false;
	reason: DenyReason;
	requiredRole: Role;
	currentRole: Role;
	/**
	 * Offcoin level at which this unlocks by itself, or null when it needs a
	 * human decision. Only Member is level-driven.
	 */
	unlockAtLevel: number | null;
	currentLevel: number;
	/** The additive group that is missing, when `reason === 'needs_grant'`. */
	missingGrant: string | null;
	appVisibility: AppVisibility;
	/** Member-facing explanation. Written once, here. */
	message: string;
}

export type CapabilityResult = CapabilityGranted | CapabilityDenied;

/**
 * The Offcoin level that grants `role` automatically, or null when the role is
 * only reachable through a human decision.
 *
 * Only Member is level-driven. `stewardMinLevel` merely makes someone eligible
 * to *ask* — surfacing it as an unlock level would promise automation that does
 * not exist.
 */
function autoUnlockLevel(role: Role): number | null {
	return role === 'member' ? POLICY.levels.memberFromLevel : null;
}

function denialMessage(
	reason: DenyReason,
	spec: CapabilitySpec,
	ctx: MemberContext,
	unlockAtLevel: number | null
): string {
	const { label } = spec;

	if (reason === 'needs_status') {
		return ctx.status === 'exited'
			? 'Your EcoHubs membership has ended.'
			: `Your membership is on standby. Reactivate it to use ${lowerFirst(label)} again.`;
	}

	if (reason === 'needs_grant') {
		return `${label} is available to members on request.`;
	}

	// needs_role
	if (unlockAtLevel !== null) {
		return `${label} unlocks when you reach Offcoin Level ${unlockAtLevel}. You're at Level ${ctx.level}.`;
	}

	if (spec.minRole === 'steward') {
		const eligible = ctx.level >= POLICY.levels.stewardMinLevel;
		return eligible
			? `${label} is open to stewards and admins. You meet the level requirement — ask an admin about becoming a steward.`
			: `${label} is open to stewards and admins.`;
	}

	return `${label} is limited to admins.`;
}

function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function deny(
	reason: DenyReason,
	appVisibility: AppVisibility,
	spec: CapabilitySpec,
	currentRole: Role,
	ctx: MemberContext
): CapabilityDenied {
	const unlockAtLevel = reason === 'needs_role' ? autoUnlockLevel(spec.minRole) : null;
	return {
		allowed: false,
		reason,
		requiredRole: spec.minRole,
		currentRole,
		unlockAtLevel,
		currentLevel: ctx.level,
		missingGrant: reason === 'needs_grant' ? (spec.grant ?? null) : null,
		appVisibility,
		message: denialMessage(reason, spec, ctx, unlockAtLevel)
	};
}

/**
 * Decide whether `ctx` may exercise `capability`, and if not, why.
 *
 * Check order is load-bearing:
 *
 * 1. `exited` short-circuits everything. Because a trial member is defined by
 *    the ABSENCE of a role, an exited member whose Authentik groups were
 *    removed would otherwise resolve to `trial` and be handed trial access.
 * 2. Role before status. A standby *trial* member asking to vote is told the
 *    truth — they lack the role — rather than "reactivate to vote", which would
 *    imply reactivating is sufficient when it isn't.
 * 3. Status before grant, so a standby member isn't invited to request access to
 *    something their status blocks anyway.
 */
export function can(capability: Capability, ctx: MemberContext): CapabilityResult {
	const spec = CAPABILITIES[capability];
	const currentRole = resolveRole(ctx.groups);

	if (ctx.status === 'exited') {
		return deny('needs_status', 'hidden', spec, currentRole, ctx);
	}

	if (!isAtLeastRole(currentRole, spec.minRole)) {
		return deny('needs_role', 'hidden', spec, currentRole, ctx);
	}

	if (!spec.statuses.includes(ctx.status)) {
		return deny('needs_status', 'locked', spec, currentRole, ctx);
	}

	if (spec.grant && !ctx.groups.includes(spec.grant)) {
		return deny('needs_grant', 'locked', spec, currentRole, ctx);
	}

	return { allowed: true };
}

/** Convenience boolean for call sites that genuinely don't need the reason. */
export function allowed(capability: Capability, ctx: MemberContext): boolean {
	return can(capability, ctx).allowed;
}

/**
 * App-surface decision for `AppDefinition.requires`, collapsing the three-tier
 * visibility rule into one call for the dock and the All Apps grid.
 *
 * - `open`   — usable
 * - `locked` — shown with an explanation, and a Request access button when requestable
 * - `hidden` — absent from both dock and All Apps (e.g. trial members)
 */
export function appSurface(
	capability: Capability,
	ctx: MemberContext
): 'open' | 'locked' | 'hidden' {
	const result = can(capability, ctx);
	if (result.allowed) return 'open';
	return result.appVisibility;
}

/**
 * Whether a denial is one the member can do something about right now by asking
 * — i.e. drives the "Request access" button that prefills the feedback widget.
 */
export function isRequestable(result: CapabilityResult): boolean {
	return !result.allowed && result.reason === 'needs_grant';
}
