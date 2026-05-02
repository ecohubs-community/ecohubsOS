<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { fade, fly, slide } from 'svelte/transition';
	import {
		createDefaultSteps,
		loadSteps,
		saveSteps,
		isSubStepEnabled,
		markSubStepCompleted,
		markSubStepCompletedById,
		getActionButton,
		performAction,
		applyProgress,
		extractProgress
	} from '$lib/onboarding/stepManager';
	import type { Step, SubStep, OnboardingProgress } from '$lib/onboarding/stepManager';
	import OnboardingAppFrame from './OnboardingAppFrame.svelte';
	import OnboardingComplete from './OnboardingComplete.svelte';

	// App component imports for inline rendering
	import WalletSetup from '$lib/apps/wallet-setup/WalletSetup.svelte';
	import WalletConnect from '$lib/apps/wallet-connect/WalletConnect.svelte';
	import SafeProposal from '$lib/apps/safe-proposal/SafeProposal.svelte';
	import PuckstackSignup from '$lib/apps/puckstack-signup/PuckstackSignup.svelte';
	import OffcoinConnect from '$lib/apps/offcoin-connect/OffcoinConnect.svelte';
	import OnboardingProfile from '$lib/apps/onboarding-profile/OnboardingProfile.svelte';
	import type { Component } from 'svelte';

	const APP_COMPONENTS: Record<string, { component: Component; title: string }> = {
		'wallet-setup': { component: WalletSetup, title: 'Wallet Setup' },
		'wallet-connect': { component: WalletConnect, title: 'Connect Wallet' },
		'safe-proposal': { component: SafeProposal, title: 'Safe Proposal' },
		'puckstack-signup': { component: PuckstackSignup, title: 'Puckstack Signup' },
		'offcoin-connect': { component: OffcoinConnect, title: 'Offcoin Connect' },
		'onboarding-profile': { component: OnboardingProfile, title: 'Set up your profile' }
	};

	let {
		serverProgress = {},
		userName = 'Member'
	}: {
		serverProgress?: OnboardingProgress;
		userName?: string;
	} = $props();

	// State
	let steps = $state<Step[]>(createDefaultSteps());
	let currentStepIndex = $state(0);
	let activeApp = $state<{ component: Component; title: string } | null>(null);
	let showCompletion = $state(false);

	// Derived
	let currentStep = $derived(steps[currentStepIndex]);
	let completedStepCount = $derived(steps.filter((s) => s.completed).length);
	let progressPercent = $derived(Math.round((completedStepCount / steps.length) * 100));
	let allDone = $derived(steps.every((s) => s.completed));
	let canGoNext = $derived(currentStep?.completed && currentStepIndex < steps.length - 1);
	let canGoBack = $derived(currentStepIndex > 0);

	// Find the first incomplete step index (the "frontier")
	let frontierIndex = $derived.by(() => {
		const idx = steps.findIndex((s) => !s.completed);
		return idx === -1 ? steps.length - 1 : idx;
	});

	function goToStep(index: number) {
		// Can go back to any completed step, or go to the frontier
		if (index <= frontierIndex) {
			currentStepIndex = index;
		}
	}

	function goNext() {
		if (canGoNext) {
			currentStepIndex++;
		}
	}

	function goBack() {
		if (canGoBack) {
			currentStepIndex--;
		}
	}

	async function handleSubAction(stepId: string, sub: SubStep) {
		const btn = getActionButton(sub);
		const result = await performAction(sub);

		if (result === 'app' && btn?.appId) {
			const appDef = APP_COMPONENTS[btn.appId];
			if (appDef) {
				activeApp = appDef;
			}
		} else if (result === 'discord') {
			// Redirect to Discord OAuth with returnTo=/onboarding
			window.location.href = '/api/discord/auth?returnTo=/onboarding';
		} else if (result === 'done') {
			steps = markSubStepCompleted(steps, stepId, sub.id);
			refreshFromLocalStorage();
		}
	}

	function handleSubSkip(stepId: string, sub: SubStep) {
		// Optional substep — mark complete and let the wizard advance.
		// Uses markSubStepCompleted (not …ById) so we can refresh local
		// state synchronously and recompute frontier/canGoNext immediately.
		steps = markSubStepCompleted(steps, stepId, sub.id);
		refreshFromLocalStorage();
	}

	function closeApp() {
		activeApp = null;
	}

	function refreshFromLocalStorage() {
		steps = loadSteps();
		// Auto-advance to frontier if current step is complete
		if (steps[currentStepIndex]?.completed && currentStepIndex < frontierIndex) {
			currentStepIndex = frontierIndex;
		}
	}

	async function handleComplete() {
		const response = await fetch('/api/onboarding/complete', { method: 'POST' });
		if (response.ok) {
			window.location.href = '/';
		}
	}

	function handleFinishSetup() {
		showCompletion = true;
	}

	onMount(() => {
		// 1. Merge server + local progress
		const localSteps = loadSteps();
		const localProgress = extractProgress(localSteps);
		const mergedProgress: OnboardingProgress = { ...localProgress, ...serverProgress };

		// 2. Apply to fresh step tree
		steps = applyProgress(createDefaultSteps(), mergedProgress);
		saveSteps(steps);

		// 3. Migrate local-only entries to server
		const newForServer: OnboardingProgress = {};
		for (const [key, value] of Object.entries(localProgress)) {
			if (!serverProgress[key]) {
				newForServer[key] = value;
			}
		}
		if (Object.keys(newForServer).length > 0) {
			fetch('/api/onboarding/progress', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ completedSteps: newForServer })
			}).catch(() => {});
		}

		// 4. Set initial step to the first incomplete one
		currentStepIndex = frontierIndex;

		// 5. Handle Discord OAuth return
		if (browser) {
			const urlParams = new URLSearchParams(window.location.search);
			const hasDiscordQueryParam = urlParams.get('discord') === 'connected';
			const hasDiscordCookie = document.cookie.includes('discord_connected=');

			if (hasDiscordQueryParam || hasDiscordCookie) {
				markSubStepCompletedById('discord-connect');
				steps = loadSteps();
				if (hasDiscordQueryParam) {
					window.history.replaceState({}, '', window.location.pathname);
				}
				document.cookie = 'discord_connected=; path=/; max-age=0';
			}
		}

		// 6. Listen for step completion events from apps
		const handleStepCompleted = () => {
			refreshFromLocalStorage();
			// Auto-close the app frame after a brief delay
			setTimeout(() => {
				activeApp = null;
			}, 800);
		};
		window.addEventListener('onboarding-step-completed', handleStepCompleted);

		return () => {
			window.removeEventListener('onboarding-step-completed', handleStepCompleted);
		};
	});

	// Step icons for the sidebar
	const STEP_ICONS = [
		'tabler:wallet',
		'tabler:package',
		'tabler:brand-discord',
		'tabler:messages',
		'tabler:chart-bar'
	];
</script>

{#if showCompletion}
	<OnboardingComplete {userName} onEnter={handleComplete} />
{:else}
	<div
		class="flex min-h-full flex-col items-center justify-center px-4 py-8 md:px-6"
		transition:fade={{ duration: 200 }}
	>
		<!-- Wizard container -->
		<div
			class="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-2xl"
			in:fly={{ y: 20, duration: 600, delay: 200 }}
		>
			<!-- Progress bar -->
			<div class="h-1 w-full bg-white/5">
				<div
					class="h-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-all duration-700 ease-out"
					style:width="{progressPercent}%"
				></div>
			</div>

			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-white/10 bg-white/5 px-6 py-4"
			>
				<div>
					<h2 class="text-lg font-bold text-white">Setup Your Account</h2>
					<p class="text-sm text-solar-100/50">
						Step {currentStepIndex + 1} of {steps.length}
						{#if allDone}
							— All steps completed!
						{/if}
					</p>
				</div>
				<span class="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/70">
					{completedStepCount}/{steps.length}
				</span>
			</div>

			<div class="flex flex-col md:flex-row">
				<!-- Step sidebar (desktop) / stepper (mobile) -->
				<nav
					class="shrink-0 border-b border-white/10 bg-white/[0.03] md:w-64 md:border-b-0 md:border-r"
				>
					<!-- Mobile: horizontal stepper -->
					<div class="flex overflow-x-auto px-4 py-3 md:hidden">
						{#each steps as step, i (step.id)}
							<button
								type="button"
								class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
									{i === currentStepIndex
									? 'bg-white/10 text-white'
									: step.completed
										? 'text-emerald-400'
										: i <= frontierIndex
											? 'text-white/50 hover:text-white/70'
											: 'cursor-not-allowed text-white/20'}"
								onclick={() => goToStep(i)}
								disabled={i > frontierIndex}
							>
								{#if step.completed}
									<Icon icon="tabler:check" class="h-4 w-4" />
								{:else}
									<span class="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs">
										{i + 1}
									</span>
								{/if}
								<span class="whitespace-nowrap text-xs">{step.title.split(' ')[0]}</span>
							</button>
						{/each}
					</div>

					<!-- Desktop: vertical step list -->
					<div class="hidden flex-col py-4 md:flex">
						{#each steps as step, i (step.id)}
							<button
								type="button"
								class="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors
									{i === currentStepIndex
									? 'border-r-2 border-amber-400 bg-white/10 text-white'
									: step.completed
										? 'text-emerald-400 hover:bg-white/5'
										: i <= frontierIndex
											? 'text-white/50 hover:bg-white/5 hover:text-white/70'
											: 'cursor-not-allowed text-white/20'}"
								onclick={() => goToStep(i)}
								disabled={i > frontierIndex}
							>
								<div
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors
										{step.completed
										? 'bg-emerald-500/20 text-emerald-400'
										: i === currentStepIndex
											? 'bg-amber-500/20 text-amber-400'
											: 'bg-white/5 text-white/40'}"
								>
									{#if step.completed}
										<Icon icon="tabler:check" class="h-4 w-4" />
									{:else}
										<Icon icon={STEP_ICONS[i] || 'tabler:circle'} class="h-4 w-4" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{step.title}</p>
									{#if step.subSteps}
										<p class="text-xs opacity-60">
											{step.subSteps.filter((s) => s.completed).length}/{step.subSteps.length} tasks
										</p>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				</nav>

				<!-- Main content area -->
				<div class="flex min-h-[400px] flex-1 flex-col md:min-h-[500px]">
					{#if currentStep}
						{#key currentStep.id}
							<div class="flex-1 p-6" transition:fade={{ duration: 150 }}>
								<!-- Step title -->
								<div class="mb-6">
									<div class="mb-1 flex items-center gap-2">
										<div
											class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20"
										>
											<Icon
												icon={STEP_ICONS[currentStepIndex] || 'tabler:circle'}
												class="h-4 w-4 text-amber-400"
											/>
										</div>
										<h3 class="text-xl font-bold text-white">{currentStep.title}</h3>
									</div>
									<p class="ml-9 text-sm text-solar-100/50">
										Complete all tasks below to proceed to the next step.
									</p>
								</div>

								<!-- Substeps -->
								{#if currentStep.subSteps}
									<div class="space-y-3">
										{#each currentStep.subSteps as sub, i (sub.id)}
											{@const enabled = isSubStepEnabled(currentStep, i)}
											{@const btn = getActionButton(sub)}
											<div
												class="flex items-center gap-4 rounded-xl border px-4 py-3 transition-all
													{sub.completed
													? 'border-emerald-500/20 bg-emerald-500/5'
													: enabled
														? 'border-white/10 bg-white/5'
														: 'border-white/5 bg-white/[0.02] opacity-50'}"
											>
												<!-- Status icon -->
												<div
													class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
														{sub.completed
														? 'bg-emerald-500/20'
														: enabled
															? 'bg-white/10'
															: 'bg-white/5'}"
												>
													{#if sub.completed}
														<Icon icon="tabler:check" class="h-4 w-4 text-emerald-400" />
													{:else if enabled}
														<span class="text-sm font-medium text-white/60">{i + 1}</span>
													{:else}
														<Icon icon="tabler:lock" class="h-3.5 w-3.5 text-white/30" />
													{/if}
												</div>

												<!-- Text -->
												<div class="flex-1">
													<p
														class="text-sm font-medium {sub.completed
															? 'text-emerald-300'
															: 'text-white'}"
													>
														{sub.title}
													</p>
													<p class="text-xs text-white/40">
														{sub.completed
															? 'Completed'
															: enabled
																? 'Ready'
																: 'Complete previous task first'}
													</p>
												</div>

												<!-- Action button (+ optional Skip) -->
												{#if !sub.completed && btn && enabled}
													<div class="flex shrink-0 items-center gap-2">
														<button
															type="button"
															onclick={() =>
																handleSubAction(currentStep.id, sub)}
															class="rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/30"
														>
															{btn.label}
														</button>
														{#if sub.optional}
															<button
																type="button"
																onclick={() =>
																	handleSubSkip(currentStep.id, sub)}
																class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white/80"
															>
																Skip
															</button>
														{/if}
													</div>
												{:else if sub.completed && btn?.type === 'url'}
													<!-- Allow re-opening external URLs even if completed -->
													<button
														type="button"
														onclick={() =>
															handleSubAction(currentStep.id, sub)}
														class="shrink-0 rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
													>
														Revisit
													</button>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/key}
					{/if}

					<!-- Navigation -->
					<div
						class="flex items-center justify-between border-t border-white/10 bg-white/[0.03] px-6 py-4"
					>
						<button
							type="button"
							onclick={goBack}
							disabled={!canGoBack}
							class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/60"
						>
							<Icon icon="tabler:arrow-left" class="h-4 w-4" />
							Back
						</button>

						<div class="flex items-center gap-3">
							{#if allDone}
								<button
									type="button"
									onclick={handleFinishSetup}
									class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-amber-500 px-6 py-2.5 text-sm font-bold text-solar-900 shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95"
								>
									Finish Setup
									<Icon icon="tabler:sparkles" class="h-4 w-4" />
								</button>
							{:else}
								<div class="group relative">
									<button
										type="button"
										onclick={goNext}
										disabled={!canGoNext}
										class="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/10"
									>
										Next
										<Icon icon="tabler:arrow-right" class="h-4 w-4" />
									</button>
									{#if !canGoNext && !currentStep?.completed}
										<span
											class="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-white/10 bg-solar-900 px-2 py-1 text-xs text-white/60 opacity-0 transition-opacity group-hover:opacity-100"
										>
											Complete all tasks to continue
										</span>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Inline app frame (rendered as modal overlay) -->
{#if activeApp}
	<OnboardingAppFrame
		component={activeApp.component}
		title={activeApp.title}
		onClose={closeApp}
	/>
{/if}
