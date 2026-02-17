<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import Icon from '@iconify/svelte';

	let { isOpen, member, onClose } = $props<{
		isOpen: boolean;
		member: any; // Using any for flexibility, but ideally this matches the Member interface
		onClose: () => void;
	}>();

	interface OnboardingStep {
		id: string;
		completedAt: Date | null;
		status: 'Completed' | 'Pending';
	}

	let steps = $derived.by(() => {
		if (!member?.onboardingProgress) return [];
		try {
			const progress = JSON.parse(member.onboardingProgress);
			// Assuming progress is { stepId: timestamp } or similar
			return Object.entries(progress)
				.map(([key, value]) => {
					// Check if value is a timestamp string or an object
					let date: Date | null = null;
					if (typeof value === 'string') {
						date = new Date(value);
					} else if (typeof value === 'object' && value !== null && 'completedAt' in value) {
						date = new Date((value as any).completedAt);
					}

					return {
						id: key,
						completedAt: date,
						status: date ? 'Completed' : 'Pending'
					} as OnboardingStep;
				})
				.sort((a, b) => {
					// Sort by completion time (latest first) or ID
					if (a.completedAt && b.completedAt)
						return b.completedAt.getTime() - a.completedAt.getTime();
					if (a.completedAt) return -1;
					if (b.completedAt) return 1;
					return a.id.localeCompare(b.id);
				});
		} catch (e) {
			console.error('Failed to parse onboarding progress:', e);
			return [];
		}
	});

	function formatDate(date: Date | null) {
		if (!date) return '-';
		return date.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
		onclick={onClose}
		role="dialog"
		aria-modal="true"
	>
		<!-- Modal Content -->
		<div
			class="glass-panel max-h-[90%] w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-solar-900 shadow-2xl"
			transition:scale={{ start: 0.95, duration: 200 }}
			onclick={(e) => e.stopPropagation()}
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
			<div class="max-h-[50vh] overflow-y-auto p-4">
				{#if steps.length === 0}
					<div class="text-solar-400/60 flex flex-col items-center justify-center py-8">
						<Icon icon="tabler:notes-off" class="mb-2 h-12 w-12 opacity-50" />
						<p class="text-sm">No onboarding data available.</p>
					</div>
				{:else}
					<div class="overflow-hidden rounded-lg border border-white/5 bg-white/5">
						<table class="w-full text-left text-sm">
							<thead class="text-solar-400/80 bg-black/20">
								<tr>
									<th class="px-4 py-2 font-medium">Step</th>
									<th class="px-4 py-2 font-medium">Completed</th>
									<th class="px-4 py-2 text-right font-medium">Status</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-white/5">
								{#each steps as step}
									<tr class="group transition-colors hover:bg-white/5">
										<td class="text-solar-200 px-4 py-2 font-medium">
											{step.id}
										</td>
										<td class="text-solar-400/80 px-4 py-2 text-xs">
											{formatDate(step.completedAt)}
										</td>
										<td class="px-4 py-2 text-right">
											{#if step.status === 'Completed'}
												<div
													class="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400"
												>
													<Icon icon="tabler:check" class="h-3 w-3" />
													Done
												</div>
											{:else}
												<div
													class="text-solar-400/60 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium"
												>
													<Icon icon="tabler:clock" class="h-3 w-3" />
													Pending
												</div>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<!-- <div class="border-t border-white/10 bg-black/20 p-4 text-right">
				<button
					class="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
					onclick={onClose}
				>
					Close
				</button>
			</div> -->
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
