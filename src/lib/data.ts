import type { Component } from 'svelte';
import Onboarding from './apps/onboarding/Onboarding.svelte';
import OnboardingFavicon from './apps/onboarding/favicon.svg';

export interface AppDefinition {
	id: string;
	name: string;
	icon: string; // Lucide icon name or emoji
	category: 'governance' | 'social' | 'ops' | 'system';
	url?: string;
	isInternalApp?: boolean;
	component?: Component;
	description: string;
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
		id: 'onboarding',
		name: 'Pathfinder',
		icon: OnboardingFavicon,
		category: 'system',
		isInternalApp: true,
		component: Onboarding,
		description: 'Start your journey. Complete steps to earn permissions.'
	},
	{
		id: 'snapshot',
		name: 'Voting',
		icon: 'vote',
		category: 'governance',
		url: 'https://snapshot.org/#/s:ecohubs.eth',
		description: 'Vote on active proposals and shape the future.'
	},
	{
		id: 'blog',
		name: 'Blog',
		icon: 'book',
		category: 'social',
		url: 'https://blog.ecohubs.community/ghost',
		description: 'Write and publish Blog articles.'
	},
	{
		id: 'forum',
		name: 'Forum',
		icon: 'message-circle',
		category: 'social',
		url: 'https://discussions.ecohubs.community',
		description: 'Deep discussions and sense-making.'
	},
	{
		id: 'task',
		name: 'Puckstack',
		icon: 'stack',
		category: 'ops',
		url: 'https://puckstack.xyz',
		description: 'Task management and maintenance.'
	},
	{
		id: 'newsletter',
		name: 'Newsletter',
		icon: 'mail',
		category: 'social',
		url: 'https://newsletter.ecohubs.community',
		description: 'Create and manage newsletters.'
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
