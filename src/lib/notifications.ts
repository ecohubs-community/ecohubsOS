export interface Notification {
	id: string;
	appId: string;
	title: string;
	time: string;
	read: boolean;
}

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
