import type { Component } from 'svelte';
import OffcoinConnect from './apps/offcoin-connect/OffcoinConnect.svelte';
import MembershipManager from './apps/membership-manager/MembershipManager.svelte';
import MembershipManagerFavicon from './apps/membership-manager/favicon.svg';
import BlogManager from './apps/blog-manager/BlogManager.svelte';
import BlogManagerFavicon from './apps/blog-manager/favicon.svg';
import VotingFavicon from './assets/icons/voting.svg';
import ForumFavicon from './assets/icons/forum.svg';
import PuckstackFavicon from './assets/icons/puckstack.svg';
import NewsletterFavicon from './assets/icons/newsletter.svg';

export interface AppDefinition {
	id: string;
	name: string;
	icon: string; // Lucide icon name or emoji
	category: 'governance' | 'social' | 'ops' | 'system';
	url?: string;
	isInternalApp?: boolean;
	component?: Component;
	description: string;
	hidden?: boolean; // Hidden apps don't appear in the dock
	helpItems?: string[]; // List of help items for external apps
}

export interface Notification {
	id: string;
	appId: string;
	title: string;
	time: string;
	read: boolean;
}

export const MOCK_APPS: AppDefinition[] = [
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
		id: 'snapshot',
		name: 'Voting',
		icon: VotingFavicon,
		category: 'governance',
		url: 'https://snapshot.org/#/s:ecohubs.eth',
		description: 'Vote on active proposals and shape the future.',
		helpItems: [
			'View and vote on active governance proposals',
			'Create new proposals for community decisions',
			'Track voting results and proposal history',
			'Participate in shaping ecohubs governance'
		]
	},
	{
		id: 'forum',
		name: 'Forum',
		icon: ForumFavicon,
		category: 'social',
		url: 'https://discussions.ecohubs.community',
		description: 'Deep discussions and sense-making.',
		helpItems: [
			'Start and join discussions on community topics',
			'Share ideas and get feedback from members',
			'Explore different categories and threads',
			'Build relationships with other community members'
		]
	},
	{
		id: 'task',
		name: 'Puckstack',
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
		hidden: true, // Only shown in All Apps, not in dock
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
		description: 'Manage blog drafts and create publication proposals.'
	}
];

export const MOCK_NOTIFICATIONS: Notification[] = [
	{
		id: '1',
		appId: 'snapshot',
		title: 'New Proposal: Solar Roof Initiative',
		time: '10m ago',
		read: false
	},
	{ id: '2', appId: 'forum', title: 'Reply to "Water Conservation"', time: '1h ago', read: false },
	{ id: '3', appId: 'onboarding', title: 'Welcome to ecohubsOS v1.0', time: 'Now', read: false }
];

export const MOCK_USER = {
	name: 'SolarArchitect',
	wallet: '0x71...3A29',
	xp: 1250,
	level: 3,
	role: 'Gardener'
};
