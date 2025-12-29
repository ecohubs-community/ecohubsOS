import { MOCK_NOTIFICATIONS } from './data';

// Define available wallpapers with metadata for "Auto" contrast
export const WALLPAPERS = [
	{
		id: 'solar-night',
		name: 'Neon Jungle',
		url: '/wallpapers/neon01.webp', // Dark forest image
		isDark: true
	},
	{
		id: 'solar-day',
		name: 'Cloud City',
		url: '/wallpapers/solar01.webp', // Bright sky image
		isDark: false
	},
	{
		id: 'deep-green',
		name: 'Deep Canopy',
		color: '#0f2e2e',
		isDark: true
	},
	{
		id: 'clean-slate',
		name: 'Paper',
		color: '#e5e5e5',
		isDark: false
	}
];

class OSState {
	// State
	isLoggedIn = $state(false);
	activeWindow = $state<string | null>(null); // App ID
	dockOpen = $state(true);

	// User State (Mock Offcoin integration)
	xp = $state(1250);
	notifications = $state([...MOCK_NOTIFICATIONS]);

	// Default to the first wallpaper
	currentWallpaper = $state(WALLPAPERS[0]);

	// 'auto' calculates based on wallpaper.isDark
	// 'light' forces Light Glass (for dark BGs)
	// 'dark' forces Dark Glass (for bright BGs)
	contrastMode = $state<'auto' | 'light' | 'dark'>('auto');

	// Derived: What visual theme should the UI use?
	// Returns 'theme-light' (white glass) or 'theme-dark' (black smoked glass)
	uiTheme = $derived.by(() => {
		if (this.contrastMode === 'auto') {
			return this.currentWallpaper.isDark ? 'theme-light' : 'theme-dark';
		}
		return this.contrastMode === 'light' ? 'theme-light' : 'theme-dark';
	});

	constructor() {}

	login() {
		this.isLoggedIn = true;
		// Play sound or trigger anim logic here
	}

	openApp(appId: string) {
		this.activeWindow = appId;
	}

	closeApp() {
		this.activeWindow = null;
	}

	claimXP(amount: number) {
		this.xp += amount;
	}

	setWallpaper(id: string) {
		const wp = WALLPAPERS.find((w) => w.id === id);
		if (wp) this.currentWallpaper = wp;
	}

	toggleContrast() {
		// Cycle: Auto -> Light -> Dark -> Auto
		if (this.contrastMode === 'auto') this.contrastMode = 'light';
		else if (this.contrastMode === 'light') this.contrastMode = 'dark';
		else this.contrastMode = 'auto';
	}
}

export const os = new OSState();
