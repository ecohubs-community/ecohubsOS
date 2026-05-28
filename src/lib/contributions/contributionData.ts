// Static data for the "Immediate Contributions" card.
//
// Icons use @iconify/svelte `tabler:*` names (consistent with the rest of the
// OS) rather than the ecohubs.community /social-icons/ SVGs.

export interface SocialLink {
	id: string;
	label: string;
	url: string;
	icon: string;
}

/** Social channels — sub-items under the "Follow us on social media" row. */
export const SOCIAL_LINKS: SocialLink[] = [
	{ id: 'social-discord', label: 'Discord', url: 'https://discord.gg/Xnh7247Nq3', icon: 'tabler:brand-discord' },
	{ id: 'social-mastodon', label: 'Mastodon', url: 'https://mastodon.social/@ecohubs', icon: 'tabler:brand-mastodon' },
	// Tabler has no Farcaster brand glyph; use a hexagon-F as a stand-in.
	{ id: 'social-farcaster', label: 'Farcaster', url: 'https://farcaster.xyz/ecohubs', icon: 'tabler:hexagon-letter-f' },
	{ id: 'social-x', label: 'X', url: 'https://x.com/eco_hubs', icon: 'tabler:brand-x' },
	{ id: 'social-youtube', label: 'YouTube', url: 'https://www.youtube.com/@ecohubs', icon: 'tabler:brand-youtube' },
	{ id: 'social-instagram', label: 'Instagram', url: 'https://www.instagram.com/ecohubs_community/', icon: 'tabler:brand-instagram' },
	{ id: 'social-linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/ecohubs/', icon: 'tabler:brand-linkedin' },
	{ id: 'social-github', label: 'GitHub', url: 'https://github.com/ecohubs-community', icon: 'tabler:brand-github' }
];

/** The Discord server members are nudged to introduce themselves in. */
export const DISCORD_URL = 'https://discord.gg/Xnh7247Nq3';

/**
 * Shared Google Calendar of EcoHubs community events (recurring weekly
 * Sunday meeting + ad-hoc events). Clicking adds it to the user's calendar.
 */
export const ECOHUBS_CALENDAR_URL =
	'https://calendar.google.com/calendar/u/0?cid=ZWQyYzZmMzAwNmJlMWQ2NzhiNWE3NDQyNjk5MjMwYTZlNmFiM2Q0YjIzYjg0MDg0MDY5YjQ4MWQyYWMxMjdkM0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t';

/** Puckstack deep links for the dynamic items. */
export const PUCKSTACK_LINKS = {
	notifications: 'https://puckstack.xyz/ecohubs/notifications',
	review: 'https://puckstack.xyz/ecohubs#review',
	open: 'https://puckstack.xyz/ecohubs'
};
