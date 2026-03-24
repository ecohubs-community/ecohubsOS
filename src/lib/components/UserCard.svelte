<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';
	import { authClient } from '$lib/auth-client';
	import { offcoin } from '$lib/offcoin.svelte';
	import { xpForNextLevel } from '$lib/utils/balances.utils';
	import { goto } from '$app/navigation';
	import { os } from '$lib/os.svelte';

	let { showWallet = false, delay = 200 }: { showWallet?: boolean; delay?: number } = $props();

	function openProfile() {
		os.openApp('my-profile');
	}

	let isLoadingLogout = $state(false);
	const xpPercent = $derived.by(() =>
		Math.min(100, Math.round((offcoin.xp / xpForNextLevel(offcoin.xp)) * 100))
	);

	async function handleLogout() {
		isLoadingLogout = true;
		try {
			await authClient.signOut();
			auth.clearUser();
		} catch {
			// Ignore errors
		}
		goto('/login');
	}
</script>

<div
	class="glass-panel group col-span-1 cursor-default rounded-2xl p-4 sm:col-span-6 md:col-span-6 md:p-5 lg:col-span-4 xl:col-span-3"
	in:fly={{ y: 20, delay }}
>
	<div class="relative mb-4 flex items-center gap-3">
		<button
			type="button"
			onclick={openProfile}
			title="Edit Profile"
			class="absolute -top-1 -right-1 rounded-full p-1 text-white/0 transition-all group-hover:text-white/40 hover:!bg-white/10 hover:!text-white"
		>
			<Icon icon="tabler:pencil" class="h-3.5 w-3.5" />
		</button>
		<button
			type="button"
			onclick={openProfile}
			class="to-purle-600 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-indigo-400 font-bold text-indigo-200/80 shadow-lg transition-all hover:ring-2 hover:ring-white/30"
		>
			{#if offcoin.isLoading}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
			{:else if auth.userAvatar}
				<img
					in:fade
					src={auth.userAvatar}
					alt="Avatar"
					class="absolute h-10 w-10 rounded-full object-cover"
				/>
			{:else if offcoin.isConnected && offcoin.avatarUrl}
				<img
					in:fade
					src={offcoin.avatarUrl}
					alt="Avatar"
					class="absolute h-10 w-10 rounded-full object-cover"
				/>
			{:else if offcoin.isConnected}
				{offcoin.name[0]}
			{:else}
				{auth.userName?.[0] ?? '?'}
			{/if}
		</button>
		<div class="min-w-0 flex-1">
			{#if offcoin.isLoading}
				<div class="mb-2 h-4 w-20 animate-pulse rounded-md bg-white/20"></div>
				<div class="flex gap-2">
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
				</div>
			{:else}
				<button type="button" onclick={openProfile} class="cursor-pointer text-left">
					<h3 class="leading-tight font-bold text-white transition-colors hover:text-white/80" in:fade>
						{#if auth.user?.displayName && offcoin.isConnected}
							{auth.user.displayName} / {offcoin.name}
						{:else if auth.user?.displayName}
							{auth.user.displayName}
						{:else if offcoin.isConnected}
							{offcoin.name}
						{:else}
							{auth.userName ?? 'Anonymous'}
						{/if}
					</h3>
				</button>
				{#if offcoin.isConnected}
					<p class="text-solar-300 text-xs">{offcoin.role} • Lvl {offcoin.level}</p>
				{:else}
					<p class="text-solar-300 text-xs">{auth.userEmail ?? 'Member'}</p>
				{/if}
				{#if auth.userGroups.includes('EcoHubs Admin')}
					<span class="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">Admin</span>
				{:else if auth.userGroups.includes('EcoHubs Member')}
					<span class="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">Member</span>
				{/if}
			{/if}
		</div>
	</div>
	{#if !offcoin.isLoading}
		{#if offcoin.isConnected}
			<div class="space-y-2" in:fade>
				<div class="flex justify-between text-xs opacity-70">
					<span>Next Level: {xpForNextLevel(offcoin.xp)} XP</span>
					<span>{xpPercent}%</span>
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-black/20">
					<div
						class="h-full bg-linear-to-r from-indigo-500 to-purple-300"
						style="width: {Math.max(xpPercent, 1)}%"
					></div>
				</div>
			</div>
		{:else}
			<p class="text-solar-300/60 text-xs">
				Connect to Offcoin via onboarding to see your XP and level.
			</p>
		{/if}
	{/if}
	{#if showWallet}
		<div
			class="text-solar-300/60 mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs"
		>
			<div class="flex items-center gap-2">
				{#if auth.walletAddress}
					<Icon icon="tabler:wallet" class="h-4 w-4" />
					<span>{auth.shortWalletAddress}</span>
					{#if auth.isSafeOwner}
						<span class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300"
							>Safe Owner</span
						>
					{/if}
				{:else}
					<Icon icon="tabler:wallet-off" class="h-4 w-4" />
					<span>No wallet connected</span>
				{/if}
			</div>
			<div>
				<button
					onclick={handleLogout}
					class="rounded-md bg-red-500/20 px-2 py-1 text-red-300 transition-colors hover:bg-red-500/30 hover:text-red-400"
				>
					{#if isLoadingLogout}
						<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
					{:else}
						Logout
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
