<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import { os } from '$lib/os.svelte';
	import { APPS, appSurfaceFor, type AppDefinition } from '$lib/data';
	import { auth } from '$lib/auth.svelte';
	import Icon from '@iconify/svelte';
	import FallbackFavicon from '$lib/assets/favicon.svg';
	import SystemFavicon from '$lib/assets/icons/system.svg';

	type Category = 'governance' | 'social' | 'ops' | 'system';

	const CATEGORY_LABELS: Record<Category, string> = {
		governance: 'Governance',
		social: 'Social',
		ops: 'Operations',
		system: 'System'
	};

	const ALL_CATEGORIES: Category[] = APPS.map((app) => app.category).filter(
		(cat, index, self) => self.indexOf(cat) === index
	) as Category[];

	let searchQuery = $state('');
	let activeCategories = new SvelteSet<Category>(ALL_CATEGORIES.filter((x) => x !== 'system'));

	function toggleCategory(category: Category) {
		if (activeCategories.has(category)) {
			activeCategories.delete(category);
		} else {
			activeCategories.add(category);
		}
	}

	let memberCtx = $derived({
		groups: auth.userGroups,
		status: auth.membershipStatus,
		level: auth.offcoinLevel
	});

	// Apps the member can see, each with its surface. `locked` entries stay in
	// the grid deliberately: a member who could *ask* for access learns the tool
	// exists and how to get it, rather than it silently not being there.
	let filteredApps = $derived(
		APPS.filter(
			(app) =>
				// `hidden` only filters the dock — apps still surface in All
				// Apps so users can discover opt-in / context-launched apps.
				// `hiddenFromAllApps` is the stronger flag that also excludes
				// from this grid (forum, newsletter while they're inactive).
				!app.hiddenFromAllApps &&
				app.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
				activeCategories.has(app.category) &&
				appSurfaceFor(app, memberCtx) !== 'hidden'
		).map((app) => ({ app, surface: appSurfaceFor(app, memberCtx) }))
	);

	/** The policy's own explanation for why an app is locked. */
	function lockedReason(app: AppDefinition): string {
		if (!app.requires) return app.description;
		const result = auth.can(app.requires);
		return result.allowed ? app.description : result.message;
	}

	/**
	 * Open an app, or — when it is locked behind a grant the member could ask
	 * for — open the feedback widget prefilled with that request instead of
	 * dropping them into a tool they cannot use.
	 */
	function openApp(appId: string) {
		const app = APPS.find((a) => a.id === appId);
		if (app && appSurfaceFor(app, memberCtx) === 'locked') {
			os.closeAllApps();
			os.openFeedback({
				subject: `Access request: ${app.name}`,
				message:
					`I'd like access to ${app.name}.\n\n` +
					`What I'd like to contribute:\n\n` +
					`(${lockedReason(app)})`
			});
			return;
		}
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

	function getAppIcon(app: (typeof APPS)[0]): string {
		if (typeof app.icon === 'string' && app.icon.startsWith('/')) {
			return app.icon;
		}
		if (typeof app.icon === 'string' && (app.icon.endsWith('.svg') || app.icon.includes('/'))) {
			return app.icon;
		}
		if (app.category === 'system') {
			return SystemFavicon;
		}
		return FallbackFavicon;
	}

	function imgError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		const appId = img.dataset.appId;
		const app = APPS.find((a) => a.id === appId);
		if (app?.category === 'system') {
			img.src = SystemFavicon;
		} else {
			img.src = FallbackFavicon;
		}
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
	<div class="mt-8 w-full max-w-md px-6 md:mt-16" transition:scale={{ duration: 200, delay: 50 }}>
		<div class="relative">
			<Icon
				icon="tabler:search"
				class="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-white/50"
			/>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search apps..."
				class="w-full rounded-xl border border-white/20 bg-white/10 py-3 pr-4 pl-12 text-white placeholder-white/50 backdrop-blur-md focus:border-white/40 focus:outline-none"
			/>
		</div>
	</div>

	<!-- Category pills -->
	<div
		class="mt-4 flex flex-wrap justify-center gap-1.5 px-6 md:gap-2"
		transition:scale={{ duration: 200, delay: 75 }}
	>
		{#each ALL_CATEGORIES as category (category)}
			<button
				class="rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 {activeCategories.has(
					category
				)
					? 'bg-white/20 text-white'
					: 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'}"
				onclick={() => toggleCategory(category)}
			>
				{CATEGORY_LABELS[category]}
			</button>
		{/each}
	</div>

	<!-- Apps grid — flat layout, no per-category headings. Filtering by
	     category still happens via the pills above. -->
	<div
		class="mt-8 flex max-h-[65vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto px-6 pb-6 md:max-h-[55vh]"
		transition:scale={{ duration: 200, delay: 100 }}
	>
		{#if filteredApps.length === 0}
			<div class="flex flex-col items-center gap-2 py-12 text-white/50">
				<Icon icon="tabler:search-off" class="h-12 w-12" />
				<p>No apps found</p>
			</div>
		{:else}
			<div class="flex flex-wrap gap-3 md:gap-6">
				{#each filteredApps as { app, surface } (app.id)}
					{@const locked = surface === 'locked'}
					<button
						class="group flex w-20 flex-col items-center gap-2 rounded-xl p-3 transition-all duration-200 hover:bg-white/10 md:w-24"
						onclick={() => openApp(app.id)}
						title={locked ? lockedReason(app) : app.description}
					>
						<div
							class="from-solar-800 relative flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br to-solar-900 shadow-lg transition-transform duration-200 group-hover:scale-110 md:h-16 md:w-16 {app.groups &&
							app.groups.includes('EcoHubs Admin')
								? 'border-2 border-blue-500/50 bg-blue-500/10'
								: ''}"
						>
							<img
								src={getAppIcon(app)}
								alt={app.name}
								class="h-10 w-10 {locked ? 'opacity-40' : ''}"
								onerror={imgError}
								data-app-id={app.id}
							/>
							{#if locked}
								<span
									class="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/20"
								>
									<Icon icon="tabler:lock" class="h-3 w-3 text-white/70" />
								</span>
							{/if}
						</div>
						<span
							class="line-clamp-2 text-center text-xs group-hover:text-white {locked
								? 'text-white/40'
								: 'text-white/80'}"
						>
							{app.name}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Close hint -->
	<div class="absolute bottom-8 text-center text-sm text-white/40">
		Press <kbd class="rounded bg-white/10 px-2 py-0.5">Esc</kbd> or click outside to close
	</div>
</div>
