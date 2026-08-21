/**
 * The Wayfinder catalogue — every video in the learning space, in the order a
 * member should meet them.
 *
 * This is the single source of truth, shared by the client (the app, the
 * progress ring) and the server (which validates that a "watched" post names a
 * video that actually exists). Adding a video means adding one entry here and
 * dropping the file into `static/videos/wayfinder/` — nothing else.
 *
 * Note that the learning-path percentage is measured against *this list*, so a
 * new entry drops everyone below 100% until they have watched it. That is the
 * intended behaviour: the path grows, and members are invited back to finish it.
 */
export interface WayfinderVideo {
	/**
	 * Stable key, persisted per member in `wayfinder_watches`. Never reuse or
	 * rename an id — doing so silently discards everyone's progress on it.
	 */
	id: string;
	title: string;
	description: string;
	/** Path under `static/`, streamed directly by the browser. */
	src: string;
	/** Free-form labels; the app derives its filter chips from these. */
	tags: string[];
	/**
	 * Runtime in whole seconds, used for the "4:03" hint before the file loads.
	 * Floor the true duration — that is what the browser's own player shows, and
	 * a hint that disagrees with the scrubber by a second reads as a bug.
	 */
	durationSeconds: number;
}

/**
 * The original welcome/intro video. Singled out because it is the one video
 * with a life outside this catalogue: it auto-opens for first-timers, pins the
 * app to the dock while unwatched, and is mirrored onto `user.introWatchedAt`
 * so members who watched it before Wayfinder existed keep their credit.
 */
export const WELCOME_VIDEO_ID = 'welcome';

export const WAYFINDER_VIDEOS: WayfinderVideo[] = [
	{
		id: WELCOME_VIDEO_ID,
		title: 'Welcome to ecohubs',
		description:
			'The big picture: who we are, how membership works, and what you can expect in your first weeks. Start here.',
		src: '/videos/wayfinder/member-onboarding.mp4',
		tags: ['Start here', 'Membership'],
		durationSeconds: 649
	},
	{
		id: 'desktop-intro',
		title: 'Getting around the desktop',
		description:
			'A tour of ecohubsOS itself — the dock, All Apps, windows, and where to find the things you need.',
		src: '/videos/wayfinder/desktop-intro.mp4',
		tags: ['Start here', 'ecohubsOS'],
		durationSeconds: 243
	},
	{
		id: 'membership-profile',
		title: 'Your membership profile',
		description:
			'Filling in your profile, what each field is used for, and how you show up to the rest of the community.',
		src: '/videos/wayfinder/membership-profile.mp4',
		tags: ['Membership', 'Apps'],
		durationSeconds: 217
	},
	{
		id: 'voting',
		title: 'Voting and proposals',
		description:
			'How decisions get made: proposals, how a vote runs, and what your vote actually does.',
		src: '/videos/wayfinder/voting.mp4',
		tags: ['Governance', 'Apps'],
		durationSeconds: 353
	}
];

/** Catalogue lookup by id. Returns undefined for ids that are not (or are no longer) in the path. */
export function findWayfinderVideo(id: string): WayfinderVideo | undefined {
	return WAYFINDER_VIDEOS.find((v) => v.id === id);
}

/** Every tag in the catalogue, de-duplicated, in first-appearance order. */
export function wayfinderTags(): string[] {
	return [...new Set(WAYFINDER_VIDEOS.flatMap((v) => v.tags))];
}

/** "10:49" / "4:03" — a runtime a member can read at a glance. */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${String(secs).padStart(2, '0')}`;
}
