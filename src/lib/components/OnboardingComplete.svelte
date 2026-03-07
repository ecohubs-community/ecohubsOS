<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fade, scale, fly } from 'svelte/transition';
	import { onMount } from 'svelte';

	let { userName = 'Member', onEnter }: { userName?: string; onEnter: () => void } = $props();

	let showIcon = $state(false);
	let showText = $state(false);
	let showButton = $state(false);
	let showParticles = $state(false);
	let entering = $state(false);

	onMount(() => {
		// Staggered animation sequence
		setTimeout(() => (showIcon = true), 200);
		setTimeout(() => (showParticles = true), 500);
		setTimeout(() => (showText = true), 800);
		setTimeout(() => (showButton = true), 1400);
	});

	async function handleEnter() {
		entering = true;
		await onEnter();
	}
</script>

<div
	class="flex min-h-full flex-col items-center justify-center px-6 py-12"
	transition:fade={{ duration: 300 }}
>
	<!-- Particle effects -->
	{#if showParticles}
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			{#each Array(20) as _, i}
				<div
					class="particle absolute rounded-full"
					style:left="{10 + Math.random() * 80}%"
					style:animation-delay="{Math.random() * 2}s"
					style:animation-duration="{3 + Math.random() * 4}s"
					style:--size="{4 + Math.random() * 8}px"
					style:--color={['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'][
						Math.floor(Math.random() * 5)
					]}
				></div>
			{/each}
		</div>
	{/if}

	<!-- Animated icon -->
	{#if showIcon}
		<div
			class="relative mb-8"
			transition:scale={{ start: 0, duration: 600, delay: 0 }}
		>
			<!-- Glow ring -->
			<div
				class="absolute -inset-4 animate-pulse rounded-full bg-gradient-to-tr from-emerald-500/30 to-amber-500/30 blur-xl"
			></div>
			<!-- Icon circle -->
			<div
				class="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-amber-400 shadow-2xl shadow-emerald-500/20"
			>
				<Icon icon="tabler:plant-2" class="h-14 w-14 text-solar-900" />
			</div>
		</div>
	{/if}

	<!-- Welcome text -->
	{#if showText}
		<div class="mb-4 text-center" transition:fly={{ y: 20, duration: 500 }}>
			<h1
				class="mb-3 bg-gradient-to-r from-emerald-400 via-amber-200 to-emerald-400 bg-clip-text text-4xl font-bold text-transparent md:text-5xl"
			>
				Welcome, {userName}!
			</h1>
			<p class="mx-auto max-w-md text-lg text-solar-100/70">
				You're all set up. Your community awaits.
			</p>
		</div>

		<div
			class="mb-10 flex flex-wrap justify-center gap-3"
			transition:fly={{ y: 20, duration: 500, delay: 200 }}
		>
			<span
				class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300"
			>
				<Icon icon="tabler:wallet" class="mr-1 inline h-3 w-3" />
				Wallet Connected
			</span>
			<span
				class="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300"
			>
				<Icon icon="tabler:brand-discord" class="mr-1 inline h-3 w-3" />
				Discord Joined
			</span>
			<span
				class="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300"
			>
				<Icon icon="tabler:checkup-list" class="mr-1 inline h-3 w-3" />
				Onboarding Complete
			</span>
		</div>
	{/if}

	<!-- Enter button -->
	{#if showButton}
		<button
			type="button"
			onclick={handleEnter}
			disabled={entering}
			class="group relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 to-amber-500 px-8 py-4 text-lg font-bold text-solar-900 shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 hover:shadow-xl hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-70"
			transition:scale={{ start: 0.9, duration: 400 }}
		>
			<span class="relative z-10 flex items-center gap-2">
				{#if entering}
					<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
					Entering...
				{:else}
					Enter ecohubsOS
					<Icon
						icon="tabler:arrow-right"
						class="h-5 w-5 transition-transform group-hover:translate-x-1"
					/>
				{/if}
			</span>
			<!-- Shimmer effect -->
			<div
				class="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
			></div>
		</button>
	{/if}
</div>

<style>
	.particle {
		width: var(--size);
		height: var(--size);
		background: var(--color);
		opacity: 0;
		animation: float-up ease-out infinite;
	}

	@keyframes float-up {
		0% {
			opacity: 0;
			transform: translateY(100vh) scale(0);
		}
		10% {
			opacity: 0.8;
		}
		50% {
			opacity: 0.4;
		}
		100% {
			opacity: 0;
			transform: translateY(-20vh) scale(1);
		}
	}
</style>
