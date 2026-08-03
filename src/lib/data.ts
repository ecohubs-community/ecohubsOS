import type { Component } from 'svelte';
import { appSurface, type Capability, type MembershipStatus } from '$lib/policy';
import OffcoinConnect from './apps/offcoin-connect/OffcoinConnect.svelte';
import PuckstackSignup from './apps/puckstack-signup/PuckstackSignup.svelte';
// import FlarumConnect from './apps/flarum-connect/FlarumConnect.svelte';
// import FlarumConnectFavicon from './apps/flarum-connect/favicon.svg';
import MembershipManager from './apps/membership-manager/MembershipManager.svelte';
import MembershipManagerFavicon from './apps/membership-manager/favicon.svg';
import BlogManager from './apps/blog-manager/BlogManager.svelte';
import BlogManagerFavicon from './apps/blog-manager/favicon.svg';
import WalletSetup from './apps/wallet-setup/WalletSetup.svelte';
import WalletConnect from './apps/wallet-connect/WalletConnect.svelte';
import SafeProposal from './apps/safe-proposal/SafeProposal.svelte';
import Voting from './apps/voting/Voting.svelte';
import Members from './apps/members/Members.svelte';
import MemberOnboarding from './apps/member-onboarding/MemberOnboarding.svelte';
import MemberOnboardingFavicon from './apps/member-onboarding/favicon.svg';
import AdminLogs from './apps/admin-logs/AdminLogs.svelte';
import FeedbackAdmin from './apps/feedback-admin/FeedbackAdmin.svelte';
import MyProfile from './apps/my-profile/MyProfile.svelte';
import MyProfileFavicon from './apps/my-profile/favicon.svg';
import WelcomeVideo from './apps/member-welcome/WelcomeVideo.svelte';
import WelcomeFavicon from './assets/icons/welcome.svg';
import VotingFavicon from './assets/icons/voting.svg';
import ForumFavicon from './assets/icons/forum.svg';
import BlueprintFavicon from './assets/icons/blueprint.svg';
import PuckstackFavicon from './assets/icons/puckstack.svg';
import NewsletterFavicon from './assets/icons/newsletter.svg';
import MembersFavicon from './assets/icons/members.svg';
import AdminLogsFavicon from './assets/icons/admin-logs.svg';
import FeedbackFavicon from './assets/icons/feedback.svg';

export interface AppDefinition {
	id: string;
	name: string;
	icon: string; // Lucide icon name or emoji
	category: 'governance' | 'social' | 'ops' | 'system';
	url?: string;
	isInternalApp?: boolean;
	component?: Component;
	description: string;
	/**
	 * Hidden from the **dock** only. Still shows up in All Apps (so users
	 * can discover and open it via the grid). Use this for apps that are
	 * opt-in or context-launched (e.g. system/onboarding apps).
	 */
	hidden?: boolean;
	/**
	 * Also hidden from the **All Apps** grid. Use this for apps that are
	 * registered but not actively in use yet (e.g. forum, newsletter)
	 * and shouldn't surface for new members. Apps with this flag are
	 * still openable programmatically via os.openApp(id).
	 */
	hiddenFromAllApps?: boolean;
	helpItems?: string[]; // List of help items for external apps
	groups?: string[]; // List of required user groups to see/access the app
	/**
	 * When true, the window shows a maximize/restore toggle so the app can be
	 * expanded to fill the viewport. Opt-in per app — best for data-dense apps
	 * (kanban boards, tables) that benefit from the extra space.
	 */
	allowFullscreen?: boolean;
	/**
	 * Membership capability governing this app, resolved through `$lib/policy`.
	 *
	 * Richer than `groups`, which is a flat any-of match: a capability also
	 * accounts for membership status and for requestable grants, and decides
	 * between *hidden* and *locked*. An app the member could ask for renders
	 * locked with an explanation; one their role cannot reach is hidden.
	 *
	 * Prefer this over `groups` for anything new. Both are honoured, and an app
	 * declaring both must satisfy both.
	 */
	requires?: Capability;
}

// Re-export from notifications.ts for backward compatibility
export { MOCK_NOTIFICATIONS, type Notification } from './notifications';

/**
 * How an app should surface for the current user: `open`, `locked` (shown with
 * an explanation, and a request path when the grant is askable), or `hidden`.
 *
 * Shared by the dock and the All Apps grid so the two cannot disagree about
 * what a member is allowed to see. Legacy `groups` and the newer `requires`
 * capability are both honoured; an app declaring both must satisfy both, and
 * the stricter outcome wins.
 */
export function appSurfaceFor(
	app: AppDefinition,
	ctx: { groups: string[]; status: MembershipStatus; level: number }
): 'open' | 'locked' | 'hidden' {
	if (app.groups && !app.groups.some((g) => ctx.groups.includes(g))) {
		return 'hidden';
	}
	if (!app.requires) return 'open';
	return appSurface(app.requires, ctx);
}

export const APPS: AppDefinition[] = [
	{
		id: 'voting',
		name: 'Voting',
		icon: VotingFavicon,
		category: 'governance',
		isInternalApp: true,
		component: Voting,
		description: 'Vote on active proposals and shape the future.',
		requires: 'voting.view',
		helpItems: [
			'View active governance proposals and past decisions',
			'Vote once you reach member status (Offcoin Level 1)',
			'Proposals are created by stewards — bring ideas via Discord',
			'Read voter reasons and outcomes for past decisions'
		]
	},
	{
		id: 'blueprint',
		name: 'Blueprint Admin',
		icon: BlueprintFavicon,
		category: 'social',
		url: 'https://blueprint.ecohubs.community/admin',
		description: 'Create the future together.',
		requires: 'blueprint.admin',
		helpItems: [
			'You will need a free github.com account to access the Blueprint Admin panel',
			'Share and collaborate on the ecohubs blueprint for regenerative communities',
			'Create and edit blueprint articles for sustainable living',
			'Explore blueprint articles from other community members',
			'Contribute to building sustainable solutions'
		]
	},
	{
		id: 'forum',
		name: 'Forum',
		icon: ForumFavicon,
		category: 'social',
		url: 'https://discussions.ecohubs.community',
		description: 'Deep discussions and sense-making.',
		// Not actively in use yet — registered for programmatic open via
		// os.openApp() but hidden from both the dock and All Apps so new
		// members don't get sent into a dead end.
		hidden: true,
		hiddenFromAllApps: true,
		helpItems: [
			'Start and join discussions on community topics',
			'Share ideas and get feedback from members',
			'Explore different categories and threads',
			'Build relationships with other community members'
		]
	},
	{
		id: 'task',
		name: 'Puckstack Task Management',
		icon: PuckstackFavicon,
		category: 'ops',
		url: 'https://puckstack.xyz/ecohubs',
		description: 'Task management and maintenance.',
		helpItems: [
			'Browse and claim available community tasks',
			'Track your task progress and contributions',
			'Collaborate with team members on projects',
			'Earn recognition for completed work'
		]
	},
	{
		id: 'newsletter',
		name: 'Newsletter',
		icon: NewsletterFavicon,
		category: 'social',
		url: 'https://newsletter.ecohubs.community',
		description: 'Create and manage newsletters.',
		requires: 'newsletter.write',
		// Hidden from the dock by default (opt-in / context-launched),
		// but visible in the All Apps grid so members can discover it.
		hidden: true,
		helpItems: [
			'Browse past newsletter editions',
			'Subscribe to receive community updates',
			'Share newsletters with your network',
			'Stay informed about ecohubs activities'
		]
	},
	{
		id: 'membership-manager',
		name: 'Membership Applications',
		icon: MembershipManagerFavicon,
		category: 'ops',
		isInternalApp: true,
		component: MembershipManager,
		description: 'Review and manage membership applications.'
	},
	{
		id: 'blog-manager',
		name: 'Blog Manager',
		icon: BlogManagerFavicon,
		category: 'social',
		isInternalApp: true,
		component: BlogManager,
		description: 'Manage blog drafts and create publication proposals.',
		requires: 'blog.write'
	},
	// Wallet & Safe — kept as registered apps so existing flows that open
	// them via os.openApp() (and any deep links) continue to work, but
	// hidden from the dock. Surfacing them is a separate UX decision.
	{
		id: 'wallet-setup',
		name: 'Wallet Setup',
		icon: 'wallet',
		category: 'system',
		isInternalApp: true,
		component: WalletSetup,
		description: 'Set up your MetaMask wallet for blockchain features.',
		hidden: true
	},
	{
		id: 'wallet-connect',
		name: 'Connect Wallet',
		icon: 'link-2',
		category: 'system',
		isInternalApp: true,
		component: WalletConnect,
		description: 'Link your wallet to your ecohubsOS account.',
		hidden: true
	},
	{
		id: 'safe-proposal',
		name: 'Safe Membership',
		icon: 'shield-check',
		category: 'system',
		isInternalApp: true,
		component: SafeProposal,
		description: 'Request to become a Safe owner for treasury governance.',
		hidden: true
	},
	{
		id: 'offcoin-connect',
		name: 'Connect to Offcoin',
		icon: 'link-2',
		category: 'system',
		isInternalApp: true,
		component: OffcoinConnect,
		description: 'Link your wallet to Offcoin to unlock XP and rewards.',
		hidden: true // Only accessible via onboarding, not shown in dock
	},
	{
		id: 'puckstack-signup',
		name: 'Join Puckstack',
		icon: 'checklist',
		category: 'system',
		isInternalApp: true,
		component: PuckstackSignup,
		description: 'Join the ecohubs workspace on Puckstack.',
		hidden: true // Only accessible via onboarding, not shown in dock
	},
	// {
	// 	id: 'flarum-connect',
	// 	name: 'Connect to Forum',
	// 	icon: FlarumConnectFavicon,
	// 	category: 'system',
	// 	isInternalApp: true,
	// 	component: FlarumConnect,
	// 	description: 'Create your account on the ecohubs Discussions Forum.',
	// 	hidden: true // Only accessible via onboarding, not shown in dock
	// },
	{
		id: 'member-welcome',
		name: 'Welcome',
		icon: WelcomeFavicon,
		category: 'ops',
		isInternalApp: true,
		component: WelcomeVideo,
		description: 'Watch the intro presentation about ecohubsOS.',
		// Hidden from the dock by default — it's surfaced on the dock only
		// while unwatched (handled in +page.svelte) and auto-opens for
		// first-timers. Once watched it lives in All Apps for rewatching.
		hidden: true,
		allowFullscreen: true
	},
	{
		id: 'my-profile',
		name: 'My Profile',
		icon: MyProfileFavicon,
		category: 'ops',
		isInternalApp: true,
		component: MyProfile,
		description: 'View and edit your profile information.'
	},
	{
		id: 'members',
		name: 'Members',
		category: 'ops',
		isInternalApp: true,
		icon: MembersFavicon,
		component: Members,
		description: 'View and manage community members.',
		groups: ['EcoHubs Admin'],
		allowFullscreen: true
	},
	{
		id: 'member-onboarding',
		name: 'Member Onboarding',
		category: 'ops',
		isInternalApp: true,
		icon: MemberOnboardingFavicon,
		component: MemberOnboarding,
		description: 'Track and guide new members through onboarding.',
		groups: ['EcoHubs Admin', 'EcoHubs Steward'],
		allowFullscreen: true
	},
	{
		id: 'admin-logs',
		name: 'System Logs',
		category: 'ops',
		icon: AdminLogsFavicon,
		isInternalApp: true,
		component: AdminLogs,
		description: 'View system logs and server activity.',
		groups: ['EcoHubs Admin']
	},
	{
		id: 'feedback-admin',
		name: 'Feedback',
		category: 'ops',
		icon: FeedbackFavicon,
		isInternalApp: true,
		component: FeedbackAdmin,
		description: 'Review member feedback and technical reports.',
		groups: ['EcoHubs Admin']
	}
];
