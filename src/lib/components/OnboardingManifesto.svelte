<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Icon from '@iconify/svelte';
	import MANIFESTO from '$lib/manifesto.md?raw';

	// The manifesto is trusted, fixed content shipped with the app, so a
	// full markdown engine + DOM sanitiser is overkill (and DOMPurify
	// breaks under SSR). We split on blank lines and treat each block as
	// a heading or paragraph based on a leading `#`.
	type Block = { kind: 'h1' | 'h2' | 'p'; text: string };
	const blocks: Block[] = MANIFESTO.split(/\n{2,}/)
		.map((b) => b.trim())
		.filter(Boolean)
		.map((b) => {
			if (b.startsWith('# ')) return { kind: 'h1', text: b.slice(2).trim() };
			if (b.startsWith('## ')) return { kind: 'h2', text: b.slice(3).trim() };
			return { kind: 'p', text: b };
		});

	let {
		signed = false,
		onSigned
	}: {
		signed?: boolean;
		onSigned: () => void;
	} = $props();

	const HOLD_DURATION_MS = 4000;

	let endSentinel = $state<HTMLDivElement | null>(null);
	let scrolledToEnd = $state(false);
	let pressing = $state(false);
	let progress = $state(0);

	let pressStart = 0;
	let rafId: number | null = null;
	let cancelTimer: ReturnType<typeof setTimeout> | null = null;
	let observer: IntersectionObserver | null = null;

	function startPress() {
		if (signed || !scrolledToEnd) return;
		pressing = true;
		pressStart = performance.now();
		const tick = () => {
			if (!pressing) return;
			const elapsed = performance.now() - pressStart;
			progress = Math.min(1, elapsed / HOLD_DURATION_MS);
			if (progress >= 1) {
				pressing = false;
				progress = 1;
				onSigned();
				return;
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
	}

	function endPress() {
		if (!pressing) return;
		pressing = false;
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		// Smoothly reset the progress bar so a release midway through
		// doesn't leave the ring stuck at a partial value.
		if (cancelTimer) clearTimeout(cancelTimer);
		cancelTimer = setTimeout(() => {
			progress = 0;
			cancelTimer = null;
		}, 150);
	}

	onMount(() => {
		// Watch a sentinel placed after the last paragraph. Whichever
		// container is doing the scrolling (the inner manifesto card or
		// the wizard's outer content area), the sentinel comes into view
		// only when the user has actually reached the bottom of the
		// manifesto text — which is the signal we want.
		if (!endSentinel) return;
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						scrolledToEnd = true;
						observer?.disconnect();
						observer = null;
						break;
					}
				}
			},
			// rootMargin lets us trip slightly before the sentinel is
			// fully on-screen, so the user doesn't have to over-scroll.
			{ threshold: 0, rootMargin: '0px 0px -16px 0px' }
		);
		observer.observe(endSentinel);
	});

	onDestroy(() => {
		if (rafId !== null) cancelAnimationFrame(rafId);
		if (cancelTimer) clearTimeout(cancelTimer);
		observer?.disconnect();
	});

	let signDisabled = $derived(!scrolledToEnd && !signed);
	let disabledTitle = 'Read the full manifesto to sign';
	let enabledTitle = 'Keep pressed for 4 seconds to sign the manifesto';
</script>

<div class="flex min-h-[420px] flex-1 flex-col">
	<div
		class="manifesto-scroll relative flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] px-4 pt-4 pb-28 text-white/85 sm:px-6 sm:pt-6 sm:pb-32"
	>
		<div class="manifesto-text">
			{#each blocks as block, i (i)}
				{#if block.kind === 'h1'}
					<h1>{block.text}</h1>
				{:else if block.kind === 'h2'}
					<h2>{block.text}</h2>
				{:else}
					<p>{block.text}</p>
				{/if}
			{/each}
		</div>
		<!-- Sentinel observed by the IntersectionObserver to detect when
		     the user has read to the end. Lives at the bottom of the
		     manifesto text content. -->
		<div bind:this={endSentinel} aria-hidden="true" class="h-px w-full"></div>
	</div>

	<!-- Floating sign button — `sticky` keeps it pinned 1rem above the
	     wizard's scrollable content viewport regardless of which
	     container is scrolling (inner manifesto card or the wizard
	     outer area). Negative top margin pulls it back over the
	     bottom edge of the manifesto card so it visually floats on it. -->
	<div
		class="pointer-events-none sticky bottom-4 z-10 -mt-16 flex justify-center pb-1"
	>
		<div class="pointer-events-auto group relative">
			{#if signed}
				<div
					class="flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-emerald-100 shadow-lg ring-1 ring-emerald-500"
				>
					<Icon icon="tabler:circle-check" class="h-5 w-5" />
					Manifesto signed
				</div>
			{:else}
				<button
					type="button"
					disabled={signDisabled}
					title={signDisabled ? disabledTitle : enabledTitle}
					aria-label={signDisabled ? disabledTitle : enabledTitle}
					onpointerdown={startPress}
					onpointerup={endPress}
					onpointerleave={endPress}
					onpointercancel={endPress}
					class="relative overflow-hidden rounded-full px-6 py-3 text-sm font-semibold shadow-lg transition-all
						{signDisabled
							? 'cursor-not-allowed bg-slate-700 text-slate-300 ring-1 ring-slate-500'
							: 'bg-gradient-to-r from-emerald-500 to-amber-500 text-solar-900 ring-1 ring-amber-300/60 hover:scale-[1.02] active:scale-[0.98]'}"
				>
					<!-- Progress fill while pressing -->
					<span
						class="pointer-events-none absolute inset-y-0 left-0 bg-white/30 transition-[width]"
						style:width="{progress * 100}%"
						style:transition-duration={pressing ? '0ms' : '180ms'}
					></span>
					<span class="relative flex items-center gap-2">
						<Icon
							icon={pressing ? 'tabler:loader-2' : 'tabler:writing-sign'}
							class="h-5 w-5 {pressing ? 'animate-spin' : ''}"
						/>
						{pressing ? 'Hold to sign…' : 'Press & hold to sign'}
					</span>
				</button>
				<!-- Tooltip -->
				<span
					class="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-solar-900 px-2 py-1 text-xs text-white/70 opacity-0 shadow transition-opacity group-hover:opacity-100"
				>
					{signDisabled ? disabledTitle : enabledTitle}
				</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.manifesto-text :global(h1) {
		color: #fff;
		font-size: 1.5em;
		font-weight: 700;
		margin: 0 0 1em;
		line-height: 1.25;
	}
	.manifesto-text :global(h2) {
		color: #fff;
		font-size: 1.2em;
		font-weight: 600;
		margin: 1.4em 0 0.6em;
		line-height: 1.3;
	}
	.manifesto-text :global(p) {
		color: rgba(255, 255, 255, 0.8);
		margin: 0.8em 0;
		line-height: 1.65;
	}
</style>
