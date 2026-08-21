<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { wayfinder } from '$lib/wayfinder.svelte';
	import {
		WAYFINDER_VIDEOS,
		WELCOME_VIDEO_ID,
		formatDuration,
		wayfinderTags,
		type WayfinderVideo
	} from '$lib/wayfinder/videos';

	// Fraction of a video that must be reached before it counts as watched.
	const WATCHED_THRESHOLD = 0.9;

	let videoEl: HTMLVideoElement | null = $state(null);
	let activeTag = $state<string | null>(null);
	let justCompletedId = $state<string | null>(null);
	/**
	 * Videos with a save already in flight. `timeupdate` fires about four times a
	 * second, and `wayfinder.hasWatched` does not turn true until the request
	 * comes back — so without this every event past the threshold starts another
	 * POST for the same video.
	 *
	 * A set rather than one id, because two saves really can overlap: if the
	 * first request stalls, the member can switch videos and finish the next one
	 * while it is still pending. With a single slot the stalled request's
	 * cleanup would clear the second video's guard and let duplicates through.
	 */
	const saving = new SvelteSet<string>();

	// Where to drop a member who hasn't picked anything yet: the welcome video
	// while it is unwatched — it is the one video that assumes nothing — then
	// the first thing they haven't finished, and finally the top of the path for
	// someone already through it.
	function defaultSelection(): string {
		const welcome = WAYFINDER_VIDEOS.find((v) => v.id === WELCOME_VIDEO_ID);
		const next =
			(welcome && !wayfinder.hasWatched(welcome.id) ? welcome : undefined) ??
			WAYFINDER_VIDEOS.find((v) => !wayfinder.hasWatched(v.id)) ??
			WAYFINDER_VIDEOS[0];
		return next?.id ?? '';
	}

	let selectedId = $state<string>(defaultSelection());
	// Set the moment the member clicks anything in the list. Until then the
	// selection is ours to revise — which matters because the initial guess is
	// made before `wayfinder.load()` has come back.
	let pickedByMember = false;

	const tags = wayfinderTags();
	const selected = $derived(
		WAYFINDER_VIDEOS.find((v) => v.id === selectedId) ?? WAYFINDER_VIDEOS[0]
	);
	const visible = $derived(
		activeTag ? WAYFINDER_VIDEOS.filter((v) => v.tags.includes(activeTag!)) : WAYFINDER_VIDEOS
	);

	// Progress ring geometry — a 44px circle with a 4px stroke.
	const RADIUS = 20;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	const dashOffset = $derived(CIRCUMFERENCE * (1 - wayfinder.percent / 100));

	function select(video: WayfinderVideo) {
		pickedByMember = true;
		if (video.id === selectedId) return;
		selectedId = video.id;
		justCompletedId = null;
		// Changing a <video>'s src attribute re-runs the media load algorithm on
		// its own, so the player resets without our help. All that's left is to
		// bring it back into view on the stacked layout, where the list sits
		// underneath the player.
		videoEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	async function markWatched(video: WayfinderVideo) {
		if (wayfinder.hasWatched(video.id) || saving.has(video.id)) return;
		saving.add(video.id);
		try {
			await wayfinder.markWatched(video.id);
			justCompletedId = video.id;
		} finally {
			// Only this video's guard — never a blanket clear, which is what would
			// release a sibling request that is still in flight.
			saving.delete(video.id);
		}
	}

	function handleTimeUpdate() {
		if (!videoEl || !selected) return;
		const { currentTime, duration } = videoEl;
		if (!duration || !Number.isFinite(duration)) return;
		if (currentTime / duration >= WATCHED_THRESHOLD) markWatched(selected);
	}

	// Safety net: if the member plays straight to the end, mark it regardless of
	// how the threshold sampling landed.
	function handleEnded() {
		if (selected) markWatched(selected);
	}

	onMount(async () => {
		// Progress arrives after the first render, so revise the opening
		// selection once it lands — unless the member has already chosen for
		// themselves. Deliberately a one-shot rather than an $effect: an effect
		// would also re-run when a video is marked watched, yanking the player
		// to the next item while the member is still in the last 10% of this one.
		await wayfinder.load();
		if (!pickedByMember) selectedId = defaultSelection();
	});
</script>

<div class="flex h-full flex-col overflow-hidden">
	<!-- Header: what this is, and how far through it you are -->
	<div class="flex items-start gap-4 border-b border-white/10 px-4 py-3">
		<div class="min-w-0 flex-1">
			<h1 class="text-base font-semibold text-white">Wayfinder</h1>
			<p class="text-xs text-white/40">
				Short videos about ecohubsOS and the apps inside it. Watch one through and it ticks off your
				path.
			</p>
		</div>

		<div class="flex shrink-0 items-center gap-3">
			<div class="hidden text-right sm:block">
				<div class="text-sm font-medium text-white">
					{wayfinder.watchedCount} of {wayfinder.total} watched
				</div>
				<div class="text-xs text-white/40">
					{wayfinder.isComplete ? 'Path complete' : `${wayfinder.unwatchedCount} to go`}
				</div>
			</div>
			<div class="relative h-11 w-11" title={`${wayfinder.percent}% of the learning path`}>
				<svg viewBox="0 0 44 44" class="h-11 w-11 -rotate-90">
					<circle
						cx="22"
						cy="22"
						r={RADIUS}
						fill="none"
						stroke="currentColor"
						stroke-width="4"
						class="text-white/10"
					/>
					<circle
						cx="22"
						cy="22"
						r={RADIUS}
						fill="none"
						stroke="currentColor"
						stroke-width="4"
						stroke-linecap="round"
						stroke-dasharray={CIRCUMFERENCE}
						stroke-dashoffset={dashOffset}
						class="text-emerald-400 transition-[stroke-dashoffset] duration-700 ease-out"
					/>
				</svg>
				<span
					class="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white"
				>
					{wayfinder.percent}%
				</span>
			</div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
		<!-- Player + detail -->
		<div class="flex min-w-0 flex-col gap-4 p-4 lg:flex-1 lg:overflow-y-auto">
			{#if selected}
				<div class="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						src={selected.src}
						controls
						preload="metadata"
						playsinline
						class="aspect-video w-full bg-black"
						ontimeupdate={handleTimeUpdate}
						onended={handleEnded}
					></video>
				</div>

				<div class="flex flex-col gap-2">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-lg font-semibold text-white">{selected.title}</h2>
						{#if wayfinder.hasWatched(selected.id)}
							<span
								class="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
							>
								<Icon icon="tabler:circle-check" class="h-3.5 w-3.5" />
								{justCompletedId === selected.id ? 'Nice — that one’s done' : 'Watched'}
							</span>
						{/if}
					</div>
					<p class="text-sm text-white/60">{selected.description}</p>
					<div class="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
						<Icon icon="tabler:clock" class="h-3.5 w-3.5" />
						<span>{formatDuration(selected.durationSeconds)}</span>
						{#each selected.tags as tag (tag)}
							<span
								class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/50"
							>
								{tag}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- The path -->
		<div
			class="flex shrink-0 flex-col border-t border-white/10 lg:w-80 lg:overflow-hidden lg:border-t-0 lg:border-l"
		>
			<div class="flex flex-wrap gap-1.5 border-b border-white/10 px-4 py-3">
				<button
					type="button"
					onclick={() => (activeTag = null)}
					class="rounded-full border px-2.5 py-1 text-xs transition-colors {activeTag === null
						? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
						: 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'}"
				>
					All
				</button>
				{#each tags as tag (tag)}
					<button
						type="button"
						onclick={() => (activeTag = activeTag === tag ? null : tag)}
						class="rounded-full border px-2.5 py-1 text-xs transition-colors {activeTag === tag
							? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
							: 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'}"
					>
						{tag}
					</button>
				{/each}
			</div>

			<div class="flex flex-col gap-1 p-2 lg:overflow-y-auto">
				{#each visible as video (video.id)}
					{@const watched = wayfinder.hasWatched(video.id)}
					<button
						type="button"
						onclick={() => select(video)}
						class="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors {video.id ===
						selectedId
							? 'border-white/20 bg-white/10'
							: 'border-transparent hover:bg-white/5'}"
					>
						<span class="mt-0.5 shrink-0">
							{#if watched}
								<Icon icon="tabler:circle-check-filled" class="h-5 w-5 text-emerald-400" />
							{:else}
								<Icon icon="tabler:circle" class="h-5 w-5 text-white/25" />
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span
								class="block truncate text-sm font-medium {watched
									? 'text-white/70'
									: 'text-white'}"
							>
								{video.title}
							</span>
							<span class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/40">
								<span>{formatDuration(video.durationSeconds)}</span>
								{#each video.tags as tag (tag)}
									<span class="rounded-full bg-white/5 px-1.5 py-0.5">{tag}</span>
								{/each}
							</span>
						</span>
					</button>
				{/each}

				{#if visible.length === 0}
					<p class="p-3 text-sm text-white/40">Nothing tagged “{activeTag}” yet.</p>
				{/if}
			</div>
		</div>
	</div>
</div>
