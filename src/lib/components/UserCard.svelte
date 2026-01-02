<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';
	import { offcoin } from '$lib/offcoin.svelte';
	import { xpForNextLevel } from '$lib/utils/balances.utils';

	let { showWallet = false, delay = 200 }: { showWallet?: boolean; delay?: number } = $props();

	const xpPercent = $derived.by(() =>
		Math.min(100, Math.round((offcoin.xp / xpForNextLevel(offcoin.xp)) * 100))
	);
</script>

<div
	class="glass-panel group col-span-1 cursor-default rounded-2xl p-5 md:col-span-3"
	in:fly={{ y: 20, delay }}
>
	<div class="mb-4 flex items-center gap-3">
		<div
			class="from-indigo-400 to-purle-600 flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br font-bold text-indigo-200/80 shadow-lg overflow-hidden"
		>
			{#if offcoin.isLoading}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
			{:else}
				{#if offcoin.isConnected}
					{#if offcoin.avatarUrl}
						<img
							in:fade
							src={offcoin.avatarUrl}
							alt="Avatar"
							class="absolute h-10 w-10 rounded-full object-cover"
						/>
					{:else}
						{offcoin.name[0]}
					{/if}
				{:else}
					{auth.shortAddress?.[0] ?? '?'}
				{/if}
			{/if}
		</div>
		<div>
			{#if offcoin.isLoading}
				<div class="mb-2 h-4 w-20 animate-pulse rounded-md bg-white/20"></div>
				<div class="flex gap-2">
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
				</div>
			{:else}
				<h3 class="leading-tight font-bold text-white" in:fade>
					{offcoin.isConnected ? offcoin.name : auth.shortAddress ?? 'Anonymous'}
				</h3>
				{#if offcoin.isConnected}
					<p class="text-solar-300 text-xs">{offcoin.role} • Lvl {offcoin.level}</p>
				{:else}
					<p class="text-solar-300 text-xs">Member</p>
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
						class={`h-full w-[${Math.max(xpPercent, 1)}%] bg-linear-to-r from-indigo-500 to-purple-300`}
					></div>
				</div>
			</div>
		{:else}
			<p class="text-solar-300/60 text-xs">
				Connect to Offcoin via onboarding to see your XP and level.
			</p>
		{/if}
	{/if}
	{#if showWallet && auth.walletAddress}
		<div class="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-solar-300/60">
			<Icon icon="tabler:wallet" class="h-4 w-4" />
			<span>{auth.shortAddress}</span>
		</div>
	{/if}
</div>
