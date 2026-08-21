import { auth } from '$lib/auth.svelte';
import { toast } from '$lib/toast.svelte';
import { WAYFINDER_VIDEOS, WELCOME_VIDEO_ID, findWayfinderVideo } from '$lib/wayfinder/videos';

/**
 * Client-side view of the member's Wayfinder progress.
 *
 * The server is the source of truth; this mirrors it so the app, the dock and
 * the badge all update the instant a video finishes, with no reload.
 */
class WayfinderState {
	/** videoId -> ISO timestamp, for videos this member has finished. */
	watched = $state<Record<string, string>>({});
	loaded = $state(false);

	private loading: Promise<void> | null = null;

	/**
	 * Fetch progress once per session. Concurrent callers share the in-flight
	 * request — the dock badge and the app both ask for this on open.
	 */
	async load(): Promise<void> {
		if (this.loaded) return;
		this.loading ??= (async () => {
			try {
				const res = await fetch('/api/wayfinder/progress');
				if (res.ok) {
					const data = await res.json();
					const next: Record<string, string> = {};
					for (const w of data.watched ?? []) next[w.videoId] = w.watchedAt;
					this.watched = next;
					this.loaded = true;
				}
			} catch (e) {
				console.error('Failed to load Wayfinder progress:', e);
			} finally {
				this.loading = null;
			}
		})();
		return this.loading;
	}

	hasWatched(videoId: string): boolean {
		// The welcome video also answers to the legacy auth flag, so a member who
		// watched the intro before Wayfinder existed sees it ticked immediately —
		// even before `load()` has come back.
		if (videoId === WELCOME_VIDEO_ID && auth.hasWatchedIntro) return true;
		return !!this.watched[videoId];
	}

	/**
	 * Persist a finished video and mirror it locally. Idempotent on both sides:
	 * a repeat call is a no-op here and the first watch wins on the server.
	 */
	async markWatched(videoId: string): Promise<void> {
		if (this.hasWatched(videoId)) return;
		try {
			const res = await fetch('/api/wayfinder/watched', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ videoId })
			});
			if (!res.ok) return;
			const data = await res.json();
			this.watched = { ...this.watched, [videoId]: data.watchedAt };
			// Keep the auth store in step so the dock pin and auto-open settle too.
			if (videoId === WELCOME_VIDEO_ID) auth.markIntroWatched(data.watchedAt);

			// `reward` is set only when this request is what paid them, so the
			// toast cannot fire twice for the same video.
			if (data.reward) {
				const title = findWayfinderVideo(videoId)?.title ?? 'that video';
				toast.reward(
					`You earned ${data.reward.eco} ECO`,
					`+${data.reward.xp} XP for finishing “${title}”`
				);
			}
		} catch (e) {
			console.error('Failed to mark Wayfinder video as watched:', e);
		}
	}

	// --- Learning path -------------------------------------------------------
	// Measured against the live catalogue, never against the stored rows. When a
	// new video ships, `total` grows and the percentage drops accordingly; a
	// retired video's rows stop counting. Watching the new one restores 100%.
	total = $derived(WAYFINDER_VIDEOS.length);
	watchedCount = $derived(WAYFINDER_VIDEOS.filter((v) => this.hasWatched(v.id)).length);
	unwatchedCount = $derived(this.total - this.watchedCount);
	percent = $derived(this.total === 0 ? 100 : Math.round((this.watchedCount / this.total) * 100));
	isComplete = $derived(this.unwatchedCount === 0);
}

export const wayfinder = new WayfinderState();
