<script lang="ts">
	import LockedApp from '$lib/components/LockedApp.svelte';
	import { appSurfaceFor } from '$lib/data';
	import { fade, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';
	import { os } from '$lib/os.svelte';
	import { auth } from '$lib/auth.svelte';
	import Icon from '@iconify/svelte';

	import type { AppDefinition } from '$lib/data';
	import FallbackFavicon from '$lib/assets/favicon.svg';
	import HelpSection from '$lib/components/HelpSection.svelte';

	let { app }: { app: AppDefinition } = $props();

	let memberCtx = $derived({
		groups: auth.userGroups,
		status: auth.membershipStatus,
		level: auth.offcoinLevel
	});

	let fullscreen = $state(false);
	// Only honour fullscreen for apps that opt in.
	const isFullscreen = $derived(fullscreen && !!app.allowFullscreen);

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
	class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm {isFullscreen
		? 'p-0'
		: 'p-2 md:p-10'}"
	transition:fade={{ duration: 200 }}
	onclick={close}
	role="presentation"
>
	<div
		class="relative flex flex-col overflow-hidden border border-white/10 bg-solar-900/80 shadow-2xl ring-1 ring-white/20 backdrop-blur-2xl {isFullscreen
			? 'h-screen w-screen max-w-none rounded-none'
			: 'h-[95vh] w-full max-w-4xl rounded-2xl md:h-[80vh]'}"
		transition:scale={{ duration: 400, easing: elasticOut, start: 0.95 }}
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		tabindex="0"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-white/5 px-4"
		>
			<div class="flex w-full items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<button
						onclick={close}
						class="rounded-full p-1.5 text-white/50 transition-colors hover:bg-red-500/20 hover:text-red-400"
					>
						<Icon icon="tabler:x" class="h-4 w-4" />
					</button>
					<div
						class="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-black/20"
					>
						<img
							src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
							alt={app.name}
							class="h-5 w-5"
							onerror={imgError}
						/>
					</div>
					<span class="text-solar-100 ml-2 text-sm font-medium">{app.name}</span>
				</div>
				<div>
					{#if app.groups && app.groups.length > 0 && app.groups.includes('EcoHubs Admin')}
						<span
							class="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-sm font-medium text-blue-400"
						>
							Admin only
						</span>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-2">
				{#if app.allowFullscreen}
					<button
						onclick={() => (fullscreen = !fullscreen)}
						class="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
						title={isFullscreen ? 'Restore window' : 'Fullscreen'}
						aria-label={isFullscreen ? 'Restore window' : 'Fullscreen'}
					>
						<Icon icon={isFullscreen ? 'tabler:minimize' : 'tabler:maximize'} class="h-4 w-4" />
					</button>
				{/if}
			</div>
		</div>

		<div class="relative flex-1 overflow-auto p-0" tabindex="0" role="dialog">
			<!-- Checked here rather than at the call site so every route in — dock,
			     All Apps, deep link — lands on the same explanation. -->
			{#if appSurfaceFor(app, memberCtx) === 'locked'}
				<LockedApp {app} />
			{:else if app.isInternalApp && app.component}
				{@const App = app.component}
				<div class="h-full flex-1 overflow-auto">
					<App />
				</div>
			{:else if app.url}
				<div class="flex h-full flex-col p-6">
					<!-- App Header -->
					<div class="mb-6 flex items-start gap-4">
						<div
							class="from-solar-400/20 to-solar-600/20 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br ring-1 ring-white/10"
						>
							<img
								src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
								alt={app.name}
								class="h-10 w-10"
								onerror={imgError}
							/>
						</div>
						<div class="flex-1">
							<h1 class="text-2xl font-bold text-white">{app.name}</h1>
							<p class="text-solar-300/80 mt-1">{app.description}</p>
						</div>
					</div>

					<!-- Help Section -->
					{#if app.helpItems && app.helpItems.length > 0}
						<HelpSection appId={app.id} title={'About the ' + app.name + ' app'} defaultOpen={true}>
							<ul class="space-y-2">
								{#each app.helpItems as item (item)}
									<li class="text-solar-300/80 flex items-start gap-2 text-sm">
										<Icon icon="tabler:check" class="text-solar-400 mt-0.5 h-4 w-4 shrink-0" />
										{item}
									</li>
								{/each}
							</ul>
						</HelpSection>
					{/if}

					{#if app.url && !app.isInternalApp}
						<button
							type="button"
							onclick={openNative}
							class="mt-6 flex items-center justify-center gap-2 rounded-xl bg-yellow-500 px-4 py-3 text-center text-slate-900 transition-colors hover:bg-yellow-400 hover:text-slate-800"
						>
							Open App <Icon icon="tabler:external-link" class="h-4 w-4" />
						</button>
					{/if}

					<!-- Action Button -->
					<div class="mt-auto pt-4">
						<button
							type="button"
							onclick={openNative}
							class="from-solar-400 to-solar-500 shadow-solar-500/20 hover:from-solar-300 hover:to-solar-400 hover:shadow-solar-500/30 flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r px-6 py-3 font-medium text-solar-900 shadow-lg transition-all hover:shadow-xl"
						>
							Open {app.name}
							<Icon icon="tabler:external-link" class="h-5 w-5" />
						</button>
					</div>
				</div>
			{:else}
				<div class="text-solar-100/70 p-8 text-center">Unable to load application</div>
			{/if}
		</div>
	</div>
</div>
