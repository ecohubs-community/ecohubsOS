import { MOCK_NOTIFICATIONS } from './notifications';

// Define available wallpapers with metadata for "Auto" contrast
export const WALLPAPERS = [
	{
		id: 'solar-night',
		name: 'Neon Jungle',
		url: '/wallpapers/neon01.webp',
		isDark: true
	},
	{
		id: 'solar-day',
		name: 'Cloud City',
		url: '/wallpapers/solar01.webp',
		isDark: false
	},
	{
		id: 'ecohub-dawn',
		name: 'EcoHub Dawn',
		url: '/wallpapers/ecohub01.webp',
		isDark: false
	},
	{
		id: 'ecohub-dusk',
		name: 'EcoHub Dusk',
		url: '/wallpapers/ecohub02.webp',
		isDark: true
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

const WALLPAPER_KEY = 'ecohubsos:wallpaper-id';
const CONTRAST_KEY = 'ecohubsos:contrast-mode';

function readStorage(key: string): string | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(key, value);
	} catch {
		/* quota exceeded / disabled — ignore */
	}
}

function loadStoredWallpaper() {
	const stored = readStorage(WALLPAPER_KEY);
	const match = stored ? WALLPAPERS.find((w) => w.id === stored) : null;
	return match ?? WALLPAPERS[0];
}

function loadStoredContrast(): 'auto' | 'light' | 'dark' {
	const stored = readStorage(CONTRAST_KEY);
	return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
}

class OSState {
	// State
	activeWindow = $state<string | null>(null); // App ID
	dockOpen = $state(true);
	showAllApps = $state(false); // All Apps modal visibility

	// One-shot deep-link payload an app picks up when it opens.
	// Cleared by the consuming app immediately after reading.
	pendingDeepLink = $state<{ appId: string; payload: unknown } | null>(null);

	// User State
	xp = $state(1250);
	notifications = $state([...MOCK_NOTIFICATIONS]);

	// Wallpaper + contrast preference. Hydrated from localStorage on
	// construction; falls back to the first wallpaper / 'auto' contrast.
	currentWallpaper = $state(loadStoredWallpaper());

	// 'auto' calculates based on wallpaper.isDark
	// 'light' forces Light Glass (for dark BGs)
	// 'dark' forces Dark Glass (for bright BGs)
	contrastMode = $state<'auto' | 'light' | 'dark'>(loadStoredContrast());

	// Derived: What visual theme should the UI use?
	// Returns 'theme-light' (white glass) or 'theme-dark' (black smoked glass)
	uiTheme = $derived.by(() => {
		if (this.contrastMode === 'auto') {
			return this.currentWallpaper.isDark ? 'theme-light' : 'theme-dark';
		}
		return this.contrastMode === 'light' ? 'theme-light' : 'theme-dark';
	});

	constructor() {}

	async logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		// The server will redirect to /login
		window.location.href = '/login';
	}

	openApp(appId: string, deepLink?: unknown) {
		this.showAllApps = false; // Close All Apps modal when opening an app
		if (deepLink !== undefined) {
			this.pendingDeepLink = { appId, payload: deepLink };
		}
		this.activeWindow = appId;
	}

	/**
	 * Apps call this in $effect to receive a deep-link payload addressed to them.
	 * Returns the payload exactly once per addressing — subsequent reads see null.
	 */
	consumeDeepLink<T = unknown>(appId: string): T | null {
		const link = this.pendingDeepLink;
		if (!link || link.appId !== appId) return null;
		this.pendingDeepLink = null;
		return link.payload as T;
	}

	closeApp() {
		this.activeWindow = null;
	}

	openAllApps() {
		this.showAllApps = true;
	}

	closeAllApps() {
		this.showAllApps = false;
	}

	claimXP(amount: number) {
		this.xp += amount;
	}

	setWallpaper(id: string) {
		const wp = WALLPAPERS.find((w) => w.id === id);
		if (!wp) return;
		this.currentWallpaper = wp;
		writeStorage(WALLPAPER_KEY, wp.id);
	}

	toggleContrast() {
		// Cycle: Auto -> Light -> Dark -> Auto
		if (this.contrastMode === 'auto') this.contrastMode = 'light';
		else if (this.contrastMode === 'light') this.contrastMode = 'dark';
		else this.contrastMode = 'auto';
		writeStorage(CONTRAST_KEY, this.contrastMode);
	}
}

export const os = new OSState();
