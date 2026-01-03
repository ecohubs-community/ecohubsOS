<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { os } from '$lib/os.svelte';
	import { MOCK_APPS } from '$lib/data';
	import Icon from '@iconify/svelte';
	import FallbackFavicon from '$lib/assets/favicon.svg';

	let searchQuery = $state('');

	let filteredApps = $derived(
		MOCK_APPS.filter((app) => app.name.toLowerCase().includes(searchQuery.toLowerCase()))
	);

	function openApp(appId: string) {
		os.openApp(appId);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			os.closeAllApps();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			os.closeAllApps();
		}
	}

	function imgError(e: Event) {
		(e.currentTarget as HTMLImageElement).src = FallbackFavicon;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="fixed inset-0 z-50 flex flex-col items-center bg-black/60 backdrop-blur-xl"
	transition:fade={{ duration: 200 }}
	onclick={handleBackdropClick}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	aria-label="All Apps"
	tabindex="-1"
>
	<!-- Search bar -->
	<div class="mt-16 w-full max-w-md px-6" transition:scale={{ duration: 200, delay: 50 }}>
		<div class="relative">
			<Icon
				icon="tabler:search"
				class="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/50"
			/>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search apps..."
				class="w-full rounded-xl border border-white/20 bg-white/10 py-3 pl-12 pr-4 text-white placeholder-white/50 backdrop-blur-md focus:border-white/40 focus:outline-none"
			/>
		</div>
	</div>

	<!-- Apps grid -->
	<div
		class="mt-12 flex max-h-[60vh] w-full max-w-4xl flex-wrap content-start justify-center gap-6 overflow-y-auto px-6 pb-6"
		transition:scale={{ duration: 200, delay: 100 }}
	>
		{#each filteredApps as app (app.id)}
			<button
				class="group flex w-24 flex-col items-center gap-2 rounded-xl p-3 transition-all duration-200 hover:bg-white/10"
				onclick={() => openApp(app.id)}
			>
				<div
					class="from-solar-800 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br to-solar-900 shadow-lg transition-transform duration-200 group-hover:scale-110"
				>
					<img
						src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
						alt={app.name}
						class="h-10 w-10"
						onerror={imgError}
					/>
				</div>
				<span class="line-clamp-2 text-center text-xs text-white/80 group-hover:text-white">
					{app.name}
				</span>
			</button>
		{/each}

		{#if filteredApps.length === 0}
			<div class="flex flex-col items-center gap-2 py-12 text-white/50">
				<Icon icon="tabler:search-off" class="h-12 w-12" />
				<p>No apps found</p>
			</div>
		{/if}
	</div>

	<!-- Close hint -->
	<div class="absolute bottom-8 text-center text-sm text-white/40">
		Press <kbd class="rounded bg-white/10 px-2 py-0.5">Esc</kbd> or click outside to close
	</div>
</div>
