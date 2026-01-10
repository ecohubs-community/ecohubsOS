import { browser } from '$app/environment';

class MobileState {
	isMobile = $state(false);

	constructor() {
		if (browser) {
			// Initialize based on current width
			this.isMobile = window.innerWidth < 768;

			// Listen for resize events
			window.addEventListener('resize', () => {
				this.isMobile = window.innerWidth < 768;
			});
		}
	}
}

export const mobile = new MobileState();
