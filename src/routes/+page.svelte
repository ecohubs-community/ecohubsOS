<script lang="ts">
	import { fly } from 'svelte/transition';
	import { os } from '$lib/os.svelte';
	import { auth } from '$lib/auth.svelte';
	import { offcoin } from '$lib/offcoin.svelte';
	import { badges } from '$lib/badges.svelte';
	import { MOCK_APPS, MOCK_NOTIFICATIONS } from '$lib/data';
	import Window from '$lib/components/Window.svelte';
	import Settings from '$lib/components/Settings.svelte';
	import OnboardingCard from '$lib/components/OnboardingCard.svelte';
	import UserCard from '$lib/components/UserCard.svelte';
	import FallbackFavicon from '$lib/assets/favicon.svg';
	import Icon from '@iconify/svelte';

	let { data } = $props();

	// Initialize auth store with server data
	$effect(() => {
		if (data.user) {
			auth.setUser(data.user);
			// Refresh badge counts when user is authenticated
			badges.refresh();
		}
	});

	// Derived state for the active app object
	let activeApp = $derived(MOCK_APPS.find((a) => a.id === os.activeWindow));

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
				class="text-solar-100/80 z-20 flex h-8 items-center justify-between bg-black/20 px-4 text-xs font-medium backdrop-blur-md"
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
						<span class="flex items-center gap-1.5">
							<Icon icon="tabler:leaf" class="h-3 w-3 text-green-400" />
							{offcoin.xp} XP
						</span>
						<span class="flex items-center gap-1.5">
							<Icon icon="tabler:coins" class="h-3 w-3 text-amber-400" />
							{offcoin.eco} ECO
						</span>
					{/if}
					<span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
					<div class="flex gap-2 opacity-70">
						<Icon icon="tabler:wifi" class="h-5 w-5" />
						<Icon icon="tabler:battery-4" class="h-5 w-5" />
					</div>
				</div>
			</header>

			<OnboardingCard />

			<div class="relative grid flex-1 grid-cols-1 content-start gap-6 p-6 md:grid-cols-12">
				<UserCard showWallet={true} delay={200} />

				<div
					class="glass-panel col-span-1 cursor-default rounded-2xl p-5 md:col-span-3"
					in:fly={{ y: 20, delay: 300 }}
				>
					<div class="mb-3 flex items-center justify-between">
						<h3 class="flex items-center gap-2 font-bold text-white">
							<Icon icon="tabler:bell" class="h-4 w-4" /> Updates
						</h3>
						<span class="rounded-md bg-red-500/20 px-1.5 py-0.5 text-xs text-red-300"
							>{MOCK_NOTIFICATIONS.length}</span
						>
					</div>
					<div class="space-y-3">
						{#each MOCK_NOTIFICATIONS as notif (notif.id)}
							<div class="group flex cursor-pointer items-start gap-3 text-sm">
								<div class="bg-solar-400 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"></div>
								<div>
									<p
										class="text-solar-50 group-hover:text-solar-300 leading-tight transition-colors"
									>
										{notif.title}
									</p>
									<p class="mt-0.5 text-xs text-white/30">{notif.time}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="col-span-6 hidden md:block"></div>
			</div>

			<div class="z-30 flex shrink-0 justify-center pb-6">
				<div
					class="flex items-end gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-2xl backdrop-blur-2xl transition-all duration-300 hover:scale-105"
					in:fly={{ y: 50, duration: 800, delay: 500 }}
				>
					{#each MOCK_APPS.filter((a) => !a.hidden) as app (app.id)}
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
								class="from-solar-800 relative flex h-12 w-12 items-center justify-center overflow-visible rounded-xl bg-linear-to-br to-solar-900 text-2xl shadow-md transition-transform duration-200 group-hover:-translate-y-2"
							>
								<img
									src={typeof app.icon === 'string' ? app.icon : FallbackFavicon}
									alt={app.name}
									class="h-8 w-8"
									onerror={imgError}
								/>
								{#if badgeCount > 0}
									<span
										class="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg"
									>
										{badgeCount > 99 ? '99+' : badgeCount}
									</span>
								{/if}
							</div>

							{#if os.activeWindow === app.id}
								<div class="bg-solar-300 absolute bottom-1 h-1 w-1 rounded-full"></div>
							{/if}
						</button>
					{/each}

					<button
						onclick={() => os.openApp('settings')}
						class="group relative flex flex-col items-center gap-1 rounded-xl p-2 transition-all duration-200 hover:bg-white/10"
					>
						<span
							class="pointer-events-none absolute -top-10 rounded border border-white/10 bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100"
						>
							Display Settings
						</span>
						<div
							class="from-solar-800 flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br to-solar-900 text-2xl shadow-lg transition-transform duration-200 group-hover:-translate-y-2"
						>
							⚙️
						</div>
					</button>

					<div class="mx-1 h-10 w-px bg-white/10"></div>

					<button
						class="group relative flex flex-col items-center p-2"
						onclick={() => alert('App Grid View')}
					>
						<div
							class="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
						>
							<Icon icon="tabler:layout-grid" class="opacity-70 group-hover:opacity-100" />
						</div>
					</button>
				</div>
			</div>

		{#if os.activeWindow === 'settings'}
			<Settings />
		{:else if os.activeWindow && activeApp}
			<Window app={activeApp!} />
		{/if}
	</div>
</main>
