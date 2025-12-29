<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';
	import { X, ExternalLink } from 'lucide-svelte';
	import { os } from '$lib/os.svelte';
	import Icon from '@iconify/svelte';
	import { FaviconExtractor } from '@iocium/favicon-extractor';

	import type { AppDefinition } from '$lib/data';
	import FallbackFavicon from '$lib/assets/favicon.svg';

	let { app }: { app: AppDefinition } = $props();

	async function getFaviconUrl(url?: string) {
		if (!url) return FallbackFavicon;
		const extractor = new FaviconExtractor();

		// Extracts from <link> tags, <meta> tags, and manifest.json
		const icons = await extractor.fetchAndExtract(url);

		// Get the largest available icon
		const largestIcon = extractor.getLargestIconsByMimeType(icons);
		return largestIcon?.[0]?.url || FallbackFavicon;
	}

	function imgError(e: Event) {
		(e.currentTarget as HTMLImageElement).src = FallbackFavicon;
	}

	function close() {
		os.closeApp();
	}

	function openNative() {
		if (app.url) {
			window.open(app.url, '_blank', 'noopener,noreferrer');
		}
	}
</script>

<div
	class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm md:p-10"
	transition:fade={{ duration: 200 }}
	onclick={close}
	role="presentation"
>
	<div
		class="relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-solar-900/80 shadow-2xl ring-1 ring-white/20 backdrop-blur-2xl"
		transition:scale={{ duration: 400, easing: elasticOut, start: 0.95 }}
		onclick={(e) => e.stopPropagation()}
		role="dialog"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-white/5 px-4"
		>
			<div class="flex items-center gap-2">
				<button
					onclick={close}
					class="rounded-full p-1.5 text-white/50 transition-colors hover:bg-red-500/20 hover:text-red-400"
				>
					<X size={16} />
				</button>
				<div
					class="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-black/20"
				>
					{#if app.isInternalApp}
						<img
							src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
							alt={app.name}
							class="h-5 w-5"
							onerror={imgError}
						/>
					{:else}
						{#await getFaviconUrl(app.url)}
							<img src={FallbackFavicon} alt={app.name} class="h-5 w-5" onerror={imgError} />
						{:then faviconUrl}
							<img src={faviconUrl} alt={app.name} class="h-5 w-5" onerror={imgError} />
						{/await}
					{/if}
				</div>
				<span class="text-solar-100 ml-2 text-sm font-medium">{app.name}</span>
			</div>
			<div class="flex items-center gap-2">
				{#if app.url && !app.isInternalApp}
					<button
						type="button"
						onclick={openNative}
						class="text-solar-300 flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs transition-colors hover:bg-white/10 hover:text-white"
					>
						Open Native <ExternalLink size={12} />
					</button>
				{/if}
			</div>
		</div>

		<div class="relative flex-1 overflow-auto p-0" tabindex="0" role="dialog">
			{#if app.isInternalApp && app.component}
				{@const App = app.component}
				<div class="flex-1 overflow-auto">
					<App />
				</div>
			{:else if app.url}
				<!-- <iframe
					src={app.url}
					class="h-full w-full"
					sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
					loading="lazy"
					referrerpolicy="no-referrer"
					allow="clipboard-read; clipboard-write; encrypted-media; picture-in-picture"
          title={app.name}
				></iframe> -->
				<div class="px-3 py-2">
					<h1 class="text-2xl">{app.name}</h1>
					<p class="my-3">app description</p>
					<button
						type="button"
						onclick={openNative}
						class="flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-3 py-2.5 text-solar-900"
					>
						Open {app.name}
						<Icon icon="tabler:link" />
					</button>
				</div>
			{:else}
				<div class="text-solar-100/70 p-8 text-center">Unable to load application</div>
			{/if}
		</div>
	</div>
</div>
