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
	import OnboardingProfileFields from './OnboardingProfileFields.svelte';
	import PuckstackIllustration from './onboarding-illustrations/PuckstackIllustration.svelte';
	import DiscordIllustration from './onboarding-illustrations/DiscordIllustration.svelte';
	import { APPS } from '$lib/data';
	import type { Component } from 'svelte';

	// Looks up an internal app component by id from the single APPS
	// registry in $lib/data. Avoids the previous dual-registry split
	// (a local APP_COMPONENTS map + the dock's APPS list) that silently
	// no-op'd when one was updated and the other forgotten.
	function getAppDef(appId: string): { component: Component; title: string } | null {
		const app = APPS.find((a) => a.id === appId && a.isInternalApp && a.component);
		return app && app.component ? { component: app.component, title: app.name } : null;
	}

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

	// Reference to the inline profile fields component, so the wizard
	// can drive its save() from the Next button.
	let profileFields = $state<{ save: () => Promise<void>; isBusy: () => boolean } | null>(null);
	let isSavingProfile = $state(false);

	// Per-step accordion state for the description block. Set of step ids
	// that are currently expanded. Default = collapsed; user opens it on
	// demand. Persists per session (not across reloads).
	let expandedDescriptions = $state(new Set<string>());

	function toggleDescription(stepId: string) {
		const next = new Set(expandedDescriptions);
		if (next.has(stepId)) next.delete(stepId);
		else next.add(stepId);
		expandedDescriptions = next;
	}

	// Derived
	let currentStep = $derived(steps[currentStepIndex]);
	let completedStepCount = $derived(steps.filter((s) => s.completed).length);
	let progressPercent = $derived(Math.round((completedStepCount / steps.length) * 100));
	let allDone = $derived(steps.every((s) => s.completed));
	// Profile step lets the user advance unconditionally — the Next click
	// itself saves the form. All other steps still gate on completion.
	let canGoNext = $derived(
		currentStepIndex < steps.length - 1 &&
			(currentStep?.completed || currentStep?.id === 'profile') &&
			!isSavingProfile
	);
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

	async function goNext() {
		if (!canGoNext) return;
		// Profile step: trigger the inline form's save before advancing.
		// On success the form fires onSaved (which marks the substep done
		// and advances frontier). On failure the form surfaces the error
		// inline and we stay on the step.
		if (currentStep?.id === 'profile' && profileFields) {
			isSavingProfile = true;
			try {
				await profileFields.save();
			} catch {
				// Error already shown inline by the component.
				return;
			} finally {
				isSavingProfile = false;
			}
		}
		currentStepIndex++;
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
			const appDef = getAppDef(btn.appId);
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

	function markProfileSubstepDone() {
		// Just update local state — markSubStepCompleted already wrote to
		// localStorage and queued the server sync. Calling
		// refreshFromLocalStorage() here would re-trigger its auto-advance
		// branch, which combined with goNext's own currentStepIndex++ would
		// skip past intermediate already-completed steps (e.g. landing on
		// Discord after profile when Puckstack is already complete).
		steps = markSubStepCompleted(steps, 'profile', 'profile-setup');
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
		class="flex min-h-full flex-col items-center justify-center px-3 py-4 sm:px-4 sm:py-8 md:px-6"
		transition:fade={{ duration: 200 }}
	>
		<!-- Wizard container — bounded to viewport height with internal
		     scrolling so a long form (e.g. profile setup) never pushes
		     the wizard footer (Back / Next) off-screen. -->
		<div
			class="flex max-h-[calc(100dvh-2rem)] min-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-2xl sm:max-h-[calc(80dvh-4rem)] sm:rounded-3xl"
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
				class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3 sm:px-6 sm:py-4"
			>
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-base font-bold text-white sm:text-lg">Setup Your Account</h2>
					<p class="text-sm text-solar-100/50">
						Step {currentStepIndex + 1} of {steps.length}
						{#if allDone}
							— All steps completed!
						{/if}
					</p>
				</div>
				<span class="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70 sm:px-3 sm:text-sm">
					{completedStepCount}/{steps.length}
				</span>
			</div>

			<div class="flex min-h-0 flex-1 flex-col md:flex-row">
				<!-- Step sidebar (desktop) / horizontal stepper (mobile) -->
				<nav
					class="shrink-0 border-b border-white/10 bg-white/[0.03] md:w-64 md:overflow-y-auto md:border-b-0 md:border-r"
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
								<span class="whitespace-nowrap text-xs">
									{step.shortTitle ?? step.title.split(' ')[0]}
								</span>
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
										<Icon icon={step.icon ?? STEP_ICONS[i] ?? 'tabler:circle'} class="h-4 w-4" />
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

				<!-- Main content area — internal scrolling so the wizard
				     footer (Back/Next) stays anchored on long forms. -->
				<div class="flex min-h-0 flex-1 flex-col">
					{#if currentStep}
						{#key currentStep.id}
							<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" transition:fade={{ duration: 150 }}>
								<!-- Inner column: lets per-step illustration blocks
								     anchor to the bottom via `mt-auto`. -->
								<div class="flex min-h-full flex-col">
								<!-- Step title -->
								<div class="mb-4 sm:mb-6">
									<div class="mb-1 flex items-center gap-2">
										<div
											class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20"
										>
											<Icon
												icon={currentStep.icon ?? STEP_ICONS[currentStepIndex] ?? 'tabler:circle'}
												class="h-4 w-4 text-amber-400"
											/>
										</div>
										<h3 class="text-lg font-bold text-white sm:text-xl">{currentStep.title}</h3>
									</div>
									<p class="ml-9 text-xs text-solar-100/50 sm:text-sm">
										{currentStep.id === 'profile'
											? 'Optional — fill it in now or skip and finish later.'
											: 'Complete all tasks below to proceed to the next step.'}
									</p>
									{#if currentStep.description}
										{@const isOpen = expandedDescriptions.has(currentStep.id)}
										<div class="ml-9 mt-3">
											<button
												type="button"
												onclick={() => toggleDescription(currentStep.id)}
												aria-expanded={isOpen}
												class="inline-flex items-center gap-1.5 text-xs font-medium text-white/55 transition-colors hover:text-white/80 sm:text-sm"
											>
												<Icon
													icon="tabler:chevron-right"
													class="h-3.5 w-3.5 transition-transform {isOpen ? 'rotate-90' : ''}"
												/>
												{isOpen ? 'Hide details' : 'What is this step about?'}
											</button>
											{#if isOpen}
												<p
													class="mt-2 text-xs leading-relaxed text-white/70 sm:text-sm"
													transition:slide={{ duration: 150 }}
												>
													{currentStep.description}
												</p>
											{/if}
										</div>
									{/if}
								</div>

								<!--
									Profile step renders its form inline rather than
									opening a modal app — simpler UX (no "open this"
									indirection) for what is really just a small form.
								-->
								{#if currentStep.id === 'profile'}
									<OnboardingProfileFields
										bind:this={profileFields}
										onSaved={() => markProfileSubstepDone()}
									/>
								{:else if currentStep.subSteps}
									<div class="space-y-3">
										{#each currentStep.subSteps as sub, i (sub.id)}
											{@const enabled = isSubStepEnabled(currentStep, i)}
											{@const btn = getActionButton(sub)}
											<div
												class="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 transition-all sm:flex-nowrap sm:gap-4 sm:px-4
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

								<!-- Per-step illustration (anchored to the bottom of
								     the step body via mt-auto). Aimed at giving the
								     user a visual sense of what the step is about. -->
								{#if currentStep.id === 'puckstack'}
									<div class="mt-auto pt-6">
										<PuckstackIllustration />
									</div>
								{:else if currentStep.id === 'discord'}
									<div class="mt-auto pt-6">
										<DiscordIllustration />
									</div>
								{/if}
								</div>
							</div>
						{/key}
					{/if}

					<!-- Navigation -->
					<div
						class="flex shrink-0 items-center justify-between border-t border-white/10 bg-white/[0.03] px-4 py-3 sm:px-6 sm:py-4"
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
										{#if isSavingProfile}
											<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
											Saving…
										{:else}
											Next
											<Icon icon="tabler:arrow-right" class="h-4 w-4" />
										{/if}
									</button>
									{#if !canGoNext && !currentStep?.completed && currentStep?.id !== 'profile' && !isSavingProfile}
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
