<script lang="ts">
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';

	// Fraction of the video that must be reached before we count it as watched.
	const WATCHED_THRESHOLD = 0.9;

	let videoEl: HTMLVideoElement | null = $state(null);
	let marking = $state(false);
	let justCompleted = $state(false);

	// Reactive: has this member already watched (from the auth store)?
	const alreadyWatched = $derived(auth.hasWatchedIntro);

	async function markWatched() {
		if (marking || auth.hasWatchedIntro) return;
		marking = true;
		try {
			const res = await fetch('/api/intro/watched', { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				auth.markIntroWatched(data.introWatchedAt);
				justCompleted = true;
			}
		} catch (e) {
			console.error('Failed to mark intro video as watched:', e);
		} finally {
			marking = false;
		}
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		const { currentTime, duration } = videoEl;
		if (!duration || !Number.isFinite(duration)) return;
		if (currentTime / duration >= WATCHED_THRESHOLD) markWatched();
	}

	// Safety net: if the member plays straight to the end, mark it regardless
	// of the threshold sampling.
	function handleEnded() {
		markWatched();
	}
</script>

<div class="text-solar-50 flex h-full flex-col gap-4 overflow-auto bg-solar-900/50 p-6">
	<div class="flex items-start gap-4">
		<div
			class="from-solar-400/20 to-solar-600/20 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br ring-1 ring-white/10"
		>
			<Icon icon="tabler:player-play" class="text-solar-300 h-7 w-7" />
		</div>
		<div class="flex-1">
			<h1 class="text-2xl font-bold text-white">Welcome to ecohubsOS</h1>
			<p class="text-solar-300/80 mt-1 text-sm">
				A short introduction to help you find your way around. Watch it through to the end and
				we'll mark it as done.
			</p>
		</div>
	</div>

	<!-- Video player -->
	<div class="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			src="/videos/member-onboarding.mp4"
			controls
			preload="metadata"
			playsinline
			class="aspect-video w-full bg-black"
			ontimeupdate={handleTimeUpdate}
			onended={handleEnded}
		></video>
	</div>

	<!-- Status row -->
	{#if alreadyWatched}
		<div class="flex items-center gap-3">
			<span
				class="flex items-center gap-2 rounded-full border border-green-400/20 bg-green-400/10 px-3 py-1.5 text-sm font-medium text-green-300"
			>
				<Icon icon="tabler:circle-check" class="h-4 w-4" />
				{justCompleted ? 'Nice — all done! You can rewatch this any time.' : 'You’ve watched this.'}
			</span>
		</div>
	{/if}
</div>
