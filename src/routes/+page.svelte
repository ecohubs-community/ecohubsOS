<script lang="ts">
	import { fly } from 'svelte/transition';
	import { os } from '$lib/os.svelte';
	import { auth } from '$lib/auth.svelte';
	import { offcoin } from '$lib/offcoin.svelte';
	import { badges } from '$lib/badges.svelte';
	import { APPS } from '$lib/data';
	import Window from '$lib/components/Window.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import AllApps from '$lib/components/AllApps.svelte';
	import UserCard from '$lib/components/UserCard.svelte';
	import ContributionCard from '$lib/components/ContributionCard.svelte';
	import FallbackFavicon from '$lib/assets/favicon.svg';
	import Icon from '@iconify/svelte';
	import { mobile } from '$lib/mobile.svelte';

	let { data } = $props();

	let fabOpen = $state(false);

	// Initialize auth store with server data
	$effect(() => {
		if (data.user) {
			auth.setUser(data.user);
			// Bootstrap Offcoin connection from server (persists across devices)
			offcoin.initFromServer(data.user.puckstackUserId);
			// Refresh badge counts when user is authenticated
			badges.refresh();
		}
	});

	// Derived state for the active app object
	let activeApp = $derived(APPS.find((a) => a.id === os.activeWindow));

	// Date time logic
	let time = $state(new Date());
	$effect(() => {
		const interval = setInterval(() => (time = new Date()), 1000);
		return () => clearInterval(interval);
	});

	function imgError(e: Event) {
		(e.currentTarget as HTMLImageElement).src = FallbackFavicon;
	}
</script>

<svelte:head>
	<title>ecohubsOS</title>
</svelte:head>

<main
	class="text-solar-50 selection:bg-solar-500/30 h-screen w-screen overflow-hidden bg-solar-900"
>
	<div
		class="relative flex h-full w-full flex-col bg-cover bg-center transition-all duration-700 {os.uiTheme}"
		style:background-image={os.currentWallpaper.url ? `url(${os.currentWallpaper.url})` : 'none'}
		style:background-color={os.currentWallpaper.color || '#0f2e2e'}
	>
		<header
			class="text-solar-100/80 z-20 flex h-10 items-center justify-between bg-black/20 px-3 text-xs font-medium backdrop-blur-md md:h-8 md:px-4"
		>
			<div class="flex items-center gap-4">
				<span class="cursor-pointer font-bold hover:text-white">ecohubsOS</span>
				<!-- <div class="hidden gap-3 md:flex">
						<span class="cursor-pointer hover:text-white">Blueprint <Icon icon="tabler:external-link" class="h-3 w-3" /></span>
						<span class="cursor-pointer hover:text-white">Network</span>
					</div> -->
			</div>
			<div class="flex items-center gap-4">
				{#if offcoin.isConnected}
					<span class="hidden items-center gap-1.5 sm:flex">
						<Icon icon="tabler:leaf" class="h-3 w-3 text-green-400" />
						{offcoin.xp} XP
					</span>
					<span class="hidden items-center gap-1.5 sm:flex">
						<Icon icon="tabler:coins" class="h-3 w-3 text-amber-400" />
						{offcoin.eco} ECO
					</span>
				{/if}
				<span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
				<div class="hidden gap-2 opacity-70 md:flex">
					<Icon icon="tabler:wifi" class="h-5 w-5" />
					<Icon icon="tabler:battery-4" class="h-5 w-5" />
				</div>
			</div>
		</header>

		<!-- Scrollable content area -->
		<div class="flex-1 overflow-y-auto md:overflow-visible">
			<div
				class="relative grid grid-cols-1 content-start items-start gap-4 p-4 md:grid-cols-12 md:gap-6 md:p-6"
			>
				<UserCard showWallet={true} delay={200} />
				<ContributionCard delay={350} />
				<div class="col-span-12 hidden md:block"></div>
			</div>
		</div>

		<!-- Desktop dock (hidden on mobile) -->
		<div class="pb-safe z-30 mb-6 hidden shrink-0 justify-center pb-6 md:flex">
			<div
				class="flex items-end gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-2xl backdrop-blur-2xl transition-all duration-300 hover:scale-105"
				in:fly={{ y: 50, duration: 800, delay: 500 }}
			>
				{#each APPS.filter((a) => !a.hidden) as app (app.id)}
					{#if !app.groups || (data.user?.groups && app.groups.some( (g) => data.user.groups.includes(g) ))}
						{@const badgeCount = badges.getCount(app.id)}
						<button
							class="group relative flex flex-col items-center gap-1 rounded-xl p-2 transition-all duration-200 hover:bg-white/10"
							onclick={() => os.openApp(app.id)}
						>
							<span
								class="pointer-events-none absolute -top-10 rounded border border-white/10 bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100"
							>
								{app.name}
							</span>

							<div
								class="from-solar-800 relative flex h-12 w-12 items-center justify-center overflow-visible rounded-xl bg-linear-to-br to-solar-900 text-2xl shadow-md transition-transform duration-200 group-hover:-translate-y-2 {app.groups &&
								app.groups.includes('EcoHubs Admin')
									? 'border-2 border-blue-500/50 bg-blue-500/10'
									: ''}"
							>
								<img
									src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
									alt={app.name}
									class="h-8 w-8"
									onerror={imgError}
								/>
								{#if badgeCount > 0}
									<span
										class="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg"
									>
										{badgeCount > 99 ? '99+' : badgeCount}
									</span>
								{/if}
							</div>

							{#if os.activeWindow === app.id}
								<div class="bg-solar-300 absolute bottom-1 h-1 w-1 rounded-full"></div>
							{/if}
						</button>
					{/if}
				{/each}

				<div class="mx-1 h-10 w-px bg-white/10"></div>

				<button
					onclick={() => os.openApp('settings')}
					class="group relative -mr-2 flex flex-col items-center p-2"
				>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
					>
						<Icon icon="tabler:user-screen" class="h-5 w-5 opacity-70 group-hover:opacity-100" />
					</div>
				</button>

				<button
					class="group relative flex flex-col items-center p-2"
					onclick={() => os.openAllApps()}
				>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
					>
						<Icon icon="tabler:layout-grid" class="opacity-70 group-hover:opacity-100" />
					</div>
				</button>
			</div>
		</div>

		<!-- FAB for mobile (outside dock, standalone) -->
		<div class="pb-safe fixed right-6 bottom-6 z-50 flex flex-col items-end gap-3 md:hidden">
			{#if fabOpen}
				<button
					class="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-md"
					transition:fly={{ y: 20, duration: 200 }}
					onclick={() => {
						os.openApp('settings');
						fabOpen = false;
					}}
				>
					Settings <Icon icon="tabler:settings" />
				</button>
				<button
					class="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-md"
					transition:fly={{ y: 20, duration: 200, delay: 50 }}
					onclick={() => {
						os.openAllApps();
						fabOpen = false;
					}}
				>
					All Apps <Icon icon="tabler:layout-grid" />
				</button>
			{/if}
			<button
				class="min-h-touch min-w-touch flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-md transition-transform duration-200"
				class:rotate-45={fabOpen}
				onclick={() => (fabOpen = !fabOpen)}
			>
				<Icon icon="tabler:plus" class="h-8 w-8" />
			</button>
		</div>

		{#if os.activeWindow === 'settings'}
			<Settings />
		{:else if os.activeWindow && activeApp}
			<Window app={activeApp!} />
		{/if}

		{#if os.showAllApps}
			<AllApps />
		{/if}
	</div>
</main>
