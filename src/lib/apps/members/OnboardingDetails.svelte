<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import {
		createDefaultSteps,
		completionRequiredSubstepIds,
		COMPLETION_OPTIONAL_SUBSTEP_IDS,
		type OnboardingProgress
	} from '$lib/onboarding/stepManager';

	const optionalIds = new Set<string>(COMPLETION_OPTIONAL_SUBSTEP_IDS);

	let { isOpen, member, onClose } = $props<{
		isOpen: boolean;
		member: any; // Using any for flexibility, but ideally this matches the Member interface
		onClose: () => void;
	}>();

	// Parsed progress record: { substepId: ISO timestamp }
	const progress = $derived.by<OnboardingProgress>(() => {
		if (!member?.onboardingProgress) return {};
		try {
			const parsed = JSON.parse(member.onboardingProgress);
			return parsed && typeof parsed === 'object' ? (parsed as OnboardingProgress) : {};
		} catch (e) {
			console.error('Failed to parse onboarding progress:', e);
			return {};
		}
	});

	interface DetailSub {
		id: string;
		title: string;
		completedAt: Date | null;
		done: boolean;
		optional: boolean;
	}
	interface DetailStep {
		id: string;
		title: string;
		icon?: string;
		subs: DetailSub[];
		done: boolean;
	}

	// Build the CURRENT required flow and overlay the member's progress onto
	// it, so we surface steps that are necessary now but not yet passed.
	const stepGroups = $derived.by<DetailStep[]>(() =>
		createDefaultSteps().map((step) => {
			const subs: DetailSub[] = (step.subSteps ?? []).map((sub) => {
				const ts = progress[sub.id];
				return {
					id: sub.id,
					title: sub.title,
					completedAt: ts ? new Date(ts) : null,
					done: !!ts,
					optional: optionalIds.has(sub.id)
				};
			});
			return {
				id: step.id,
				title: step.title,
				icon: step.icon,
				subs,
				// A step counts as done when every blocking substep is done.
				done: subs.length > 0 && subs.every((s) => s.done || s.optional)
			};
		})
	);

	const pending = $derived(completionRequiredSubstepIds().filter((id) => !progress[id]));
	const allComplete = $derived(pending.length === 0);

	// Substeps the member completed that are no longer part of the current
	// flow (e.g. retired steps) — shown for transparency.
	const legacyDone = $derived.by(() => {
		const required = new Set(completionRequiredSubstepIds());
		return Object.keys(progress)
			.filter((id) => progress[id] && !required.has(id))
			.map((id) => ({ id, completedAt: new Date(progress[id]) }))
			.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
	});

	function formatDate(date: Date | null) {
		if (!date) return '—';
		return date.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if isOpen}
	<!-- Backdrop (click outside / Escape to close) -->
	<div
		class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		onclick={(e) => {
			if (e.target === e.currentTarget) onClose();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') onClose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- Modal Content -->
		<div
			class="glass-panel max-h-[90%] w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-solar-900 shadow-2xl"
			transition:scale={{ start: 0.95, duration: 200 }}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-white/10 p-2">
				<h3 class="text-solar-50 flex items-center gap-2 text-sm font-semibold">
					<Icon icon="tabler:list-check" class="text-solar-400" />
					Onboarding: {member?.name}
				</h3>
				<button
					class="text-solar-400 rounded-full p-1 transition-colors hover:bg-white/10 hover:text-white"
					onclick={onClose}
				>
					<Icon icon="tabler:x" class="h-5 w-5" />
				</button>
			</div>

			<!-- Body -->
			<div class="max-h-[60vh] space-y-4 overflow-y-auto p-4">
				<!-- Summary banner: status derived from current required steps -->
				{#if allComplete}
					<div
						class="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-300"
					>
						<Icon icon="tabler:circle-check" class="h-4 w-4 flex-shrink-0" />
						<span>All currently required steps completed.</span>
					</div>
				{:else}
					<div
						class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
					>
						<Icon icon="tabler:alert-triangle" class="h-4 w-4 flex-shrink-0" />
						<span>{pending.length} required step{pending.length === 1 ? '' : 's'} still outstanding.</span>
					</div>
				{/if}

				<!-- Current required steps, grouped by step -->
				{#each stepGroups as group (group.id)}
					<div class="overflow-hidden rounded-lg border border-white/5 bg-white/5">
						<div
							class="flex items-center gap-2 border-b border-white/5 bg-black/20 px-3 py-2 text-xs font-semibold text-solar-200"
						>
							{#if group.icon}
								<Icon icon={group.icon} class="text-solar-400 h-4 w-4" />
							{/if}
							<span class="flex-1">{group.title}</span>
							{#if group.done}
								<Icon icon="tabler:circle-check-filled" class="h-4 w-4 text-green-400" />
							{:else}
								<Icon icon="tabler:circle-dashed" class="text-solar-400/60 h-4 w-4" />
							{/if}
						</div>
						<ul class="divide-y divide-white/5">
							{#each group.subs as sub (sub.id)}
								<li class="flex items-center gap-2 px-3 py-2 text-sm">
									<span class="text-solar-200 flex-1">{sub.title}</span>
									<span class="text-solar-400/70 text-xs">{formatDate(sub.completedAt)}</span>
									{#if sub.done}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400"
										>
											<Icon icon="tabler:check" class="h-3 w-3" />
											Done
										</span>
									{:else if sub.optional}
										<span
											class="text-solar-400/70 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium"
										>
											<Icon icon="tabler:minus" class="h-3 w-3" />
											Optional
										</span>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300"
										>
											<Icon icon="tabler:clock" class="h-3 w-3" />
											Not passed
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}

				<!-- Steps completed under an older flow, no longer required -->
				{#if legacyDone.length > 0}
					<div class="overflow-hidden rounded-lg border border-white/5 bg-white/5">
						<div
							class="border-b border-white/5 bg-black/20 px-3 py-2 text-xs font-semibold text-solar-400/80"
						>
							Previously completed (no longer required)
						</div>
						<ul class="divide-y divide-white/5">
							{#each legacyDone as item (item.id)}
								<li class="flex items-center gap-2 px-3 py-2 text-sm">
									<span class="text-solar-400/70 flex-1">{item.id}</span>
									<span class="text-solar-400/60 text-xs">{formatDate(item.completedAt)}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Reusing glass panel style if defined globally, otherwise fallback */
	.glass-panel {
		background: rgba(17, 24, 39, 0.95); /* fallback for solar-900 */
		backdrop-filter: blur(12px);
	}
</style>
