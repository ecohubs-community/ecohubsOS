<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	// Props for future composition
	let { title = 'Onboarding', defaultHeightVh = 65 } = $props();

	// State
	let isExpanded = $state(true);
	let isCompleted = $state(false);
	let contentId = $state(`onboarding-content-${Math.floor(Math.random() * 1e6)}`);

	// Mock data rendered inside the card
	type Step = { id: number; label: string; done: boolean };
	let steps = $state<Step[]>([
		{ id: 1, label: 'Create your profile', done: true },
		{ id: 2, label: 'Connect your wallet', done: false },
		{ id: 3, label: 'Join a hub', done: false },
		{ id: 4, label: 'Complete first mission', done: false },
		{ id: 5, label: 'Claim rewards', done: false }
	]);

	function toggle() {
		isExpanded = !isExpanded;
		localStorage.setItem('onboarding-card-expanded', JSON.stringify(isExpanded));
	}

	onMount(() => {
		const completed = localStorage.getItem('onboarding-completed');
		isCompleted = !!completed;

		// Default expanded when not completed; collapsed when completed
		const persisted = localStorage.getItem('onboarding-card-expanded');
		if (persisted !== null) {
			isExpanded = JSON.parse(persisted);
		} else {
			isExpanded = !isCompleted;
		}
	});
</script>

<!-- Container -->
<section
	class="glass-panel fixed top-14 right-6 z-30 w-[clamp(280px,28vw,380px)] rounded-2xl shadow-2xl backdrop-blur-2xl transition-all duration-300"
	style:height={isExpanded ? `min(${defaultHeightVh}vh, 720px)` : '3.25rem'}
	aria-labelledby={contentId + '-header'}
>
	<!-- Header -->
	<div
		id={contentId + '-header'}
		class="flex h-13 items-center justify-between border-b border-white/10 bg-white/5 px-4"
	>
		<h3 class="flex items-center gap-2 font-bold text-white">
			{title}
			{#if isCompleted && !isExpanded}
				<Icon icon="tabler:check" class="text-green-400" />
			{/if}
		</h3>
		<button
			type="button"
			onclick={toggle}
			class="rounded-md px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10 focus:ring-2 focus:ring-white/30 focus:outline-none"
			aria-controls={contentId}
			aria-expanded={isExpanded}
		>
			{isExpanded ? 'Collapse' : 'Expand'}
		</button>
	</div>

	<!-- Content with transform-based animation -->
	<div
		id={contentId}
		class="origin-top transition-transform duration-300"
		style:transform={isExpanded ? 'scaleY(1)' : 'scaleY(0)'}
		aria-hidden={!isExpanded}
	>
		<div
			class="overflow-y-auto scroll-smooth p-4 will-change-transform"
			style:max-height={`calc(${defaultHeightVh}vh - 3.25rem)`}
		>
			<!-- Mock content -->
			<ul class="space-y-3">
				{#each steps as step (step.id)}
					<li class="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
						<div class="mt-0.5">
							<Icon
								icon={step.done ? 'tabler:check' : 'tabler:circle'}
								class={step.done ? 'text-green-400' : 'text-white/40'}
							/>
						</div>
						<div class="flex-1">
							<p class="text-sm text-white">{step.label}</p>
							{#if !step.done}
								<p class="text-xs text-white/40">Complete to unlock rewards</p>
							{/if}
						</div>
						<button
							type="button"
							class="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/15 focus:ring-2 focus:ring-white/30 focus:outline-none"
							onclick={() =>
								(steps = steps.map((s) => (s.id === step.id ? { ...s, done: true } : s)))}
						>
							Mark done
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>

<style>
	/* Minimal utility to align header height consistently */
	.h-13 {
		height: 3.25rem;
	}
</style>
