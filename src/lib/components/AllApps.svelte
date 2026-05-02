<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { os } from '$lib/os.svelte';
	import { APPS } from '$lib/data';
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

	let filteredApps = $derived(
		APPS.filter(
			(app) =>
				!app.hidden &&
				app.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
				activeCategories.has(app.category) &&
				(!app.groups ||
					(page.data.user?.groups &&
						app.groups.some((g: string) => page.data.user.groups.includes(g))))
		)
	);

	let groupedApps = $derived.by(() => {
		const groups: Record<Category, typeof APPS> = {
			governance: [],
			social: [],
			ops: [],
			system: []
		};

		for (const app of filteredApps) {
			groups[app.category].push(app);
		}

		return groups;
	});

	let visibleCategories = $derived(
		ALL_CATEGORIES.filter((cat) => activeCategories.has(cat) && groupedApps[cat].length > 0)
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

	<!-- Apps grid grouped by category -->
	<div
		class="mt-8 flex max-h-[65vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto px-6 pb-6 md:max-h-[55vh] md:gap-8"
		transition:scale={{ duration: 200, delay: 100 }}
	>
		{#each visibleCategories as category (category)}
			<div class="flex flex-col gap-4">
				<h2 class="text-sm font-semibold tracking-wider text-white/50 uppercase">
					{CATEGORY_LABELS[category]}
				</h2>
				<div class="flex flex-wrap gap-3 md:gap-6">
					{#each groupedApps[category] as app (app.id)}
						<button
							class="group flex w-20 flex-col items-center gap-2 rounded-xl p-3 transition-all duration-200 hover:bg-white/10 md:w-24"
							onclick={() => openApp(app.id)}
						>
							<div
								class="from-solar-800 flex h-12 w-12 items-center justify-center rounded-2xl bg-linear-to-br to-solar-900 shadow-lg transition-transform duration-200 group-hover:scale-110 md:h-16 md:w-16 {app.groups &&
								app.groups.includes('EcoHubs Admin')
									? 'border-2 border-blue-500/50 bg-blue-500/10'
									: ''}"
							>
								<img
									src={getAppIcon(app)}
									alt={app.name}
									class="h-10 w-10"
									onerror={imgError}
									data-app-id={app.id}
								/>
							</div>
							<span class="line-clamp-2 text-center text-xs text-white/80 group-hover:text-white">
								{app.name}
							</span>
						</button>
					{/each}
				</div>
			</div>
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
