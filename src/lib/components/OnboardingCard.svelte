<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { os } from '$lib/os.svelte';
	// Props for future composition
	let { title = 'Onboarding', defaultHeightVh = 65 } = $props();

	// State
	let isExpanded = $state(true);
	let isCompleted = $state(false);
	let contentId = $state(`onboarding-content-${Math.floor(Math.random() * 1e6)}`);

	// Hierarchical steps and actions
	import {
		createDefaultSteps,
		loadSteps,
		saveSteps,
		isSubStepEnabled,
		markSubStepCompleted,
		markStepCompleted,
		getActionButton,
		performAction
	} from '$lib/onboarding/stepManager';
	import type { Step, SubStep } from '$lib/onboarding/stepManager';

	let steps = $state<Step[]>(loadSteps());
	let expandedSections = $state<Record<string, boolean>>({});

	function toggleSection(stepId: string) {
		expandedSections = { ...expandedSections, [stepId]: !expandedSections[stepId] };
	}

	function resetSteps() {
		steps = createDefaultSteps();
		saveSteps(steps);
	}

	async function handleSubAction(stepId: string, sub: SubStep) {
		const btn = getActionButton(sub);
		const result = await performAction(sub);

		if (result === 'app' && btn?.appId) {
			// Open the app in ecohubsOS - the app will handle completion via markSubStepCompletedById
			os.openApp(btn.appId);
			// Don't mark as completed here - the app will call markSubStepCompletedById on success
		} else if (result === 'done') {
			steps = markSubStepCompleted(steps, stepId, sub.id);
		}
		// 'error' result: don't mark as completed
	}

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

		// Listen for step completion events from apps (e.g., OffcoinConnect)
		const handleStepCompleted = () => {
			steps = loadSteps();
		};
		window.addEventListener('onboarding-step-completed', handleStepCompleted);

		return () => {
			window.removeEventListener('onboarding-step-completed', handleStepCompleted);
		};
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
			<!-- Hierarchical onboarding -->
			<div class="space-y-4">
				{#each steps as step (step.id)}
					<div
						class="flex flex-col rounded-2xl border border-white/10 bg-white/5 transition-transform duration-300"
					>
						<button
							type="button"
							class="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left hover:bg-white/10 focus:ring-2 focus:ring-white/30 focus:outline-none"
							onclick={() => toggleSection(step.id)}
							aria-controls={`section-${step.id}`}
							aria-expanded={!!expandedSections[step.id]}
						>
							<span class="flex items-center gap-2">
								<Icon
									icon={step.completed ? 'tabler:check' : 'tabler:circle'}
									class={step.completed ? 'text-green-400' : 'text-white/40'}
								/>
								<span class="font-medium text-white">{step.title}</span>
							</span>
							<Icon
								icon={expandedSections[step.id] ? 'tabler:chevron-up' : 'tabler:chevron-down'}
								class="text-white/60"
							/>
						</button>

						<div
							id={`section-${step.id}`}
							class="h-0 origin-top overflow-hidden transition-transform duration-300"
							style:transform={expandedSections[step.id] ? 'scaleY(1)' : 'scaleY(0)'}
							style:height={expandedSections[step.id] ? 'auto' : '0px'}
							aria-hidden={!expandedSections[step.id]}
						>
							{#if step.subSteps && step.subSteps.length > 0}
								<ul class="space-y-3 px-4 pb-4">
									{#each step.subSteps as sub, i (sub.id)}
										<li
											class="flex items-start gap-3 rounded-xl border border-white/10 bg-black/10 p-3"
										>
											<Icon
												icon={sub.completed ? 'tabler:check' : 'tabler:circle'}
												class={sub.completed ? 'text-green-400' : 'text-white/40'}
											/>
											<div class="flex-1">
												<p class="text-sm text-white">{sub.title}</p>
												<p class="text-xs text-white/40">
													{sub.completed
														? 'Completed'
														: isSubStepEnabled(step, i)
															? 'Ready'
															: 'Locked'}
												</p>
											</div>
											{#if !sub.completed || sub.actions[0]?.type === 'url'}
												{@const btn = getActionButton(sub)}
												{#if btn}
													<button
														type="button"
														disabled={!isSubStepEnabled(step, i)}
														aria-disabled={!isSubStepEnabled(step, i)}
														onclick={() => handleSubAction(step.id, sub)}
														class="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/15 focus:ring-2 focus:ring-white/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
													>
														{btn.label}
													</button>
												{/if}
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<div class="flex items-center justify-between px-4 pb-4">
									<span class="text-xs text-white/50">Single step</span>
									{#if step.url}
										<button
											type="button"
											class="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/15 focus:ring-2 focus:ring-white/30 focus:outline-none"
											onclick={() => {
												window.open(step.url!, '_blank', 'noopener,noreferrer');
												steps = markStepCompleted(steps, step.id);
											}}
										>
											Open Site
										</button>
									{:else if step.email}
										<button
											type="button"
											class="rounded-md bg-white/10 px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/15 focus:ring-2 focus:ring-white/30 focus:outline-none"
											onclick={async () => {
												const res = await fetch('/api/onboarding/email', {
													method: 'POST',
													headers: { 'content-type': 'application/json' },
													body: JSON.stringify(step.email)
												});
												if (res.ok) {
													steps = markStepCompleted(steps, step.id);
												}
											}}
										>
											Request
										</button>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<div class="mt-4 flex justify-end">
				<button
					type="button"
					class="rounded-md bg-white/10 px-3 py-2 text-xs text-white/80 transition-colors hover:bg-white/15 focus:ring-2 focus:ring-white/30 focus:outline-none"
					onclick={resetSteps}
				>
					Reset onboarding
				</button>
			</div>
		</div>
	</div>
</section>

<style>
	/* Minimal utility to align header height consistently */
	.h-13 {
		height: 3.25rem;
	}
</style>
