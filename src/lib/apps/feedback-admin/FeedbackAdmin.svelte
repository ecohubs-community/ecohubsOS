<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { badges } from '$lib/badges.svelte';

	interface FeedbackItem {
		id: string;
		title: string;
		message: string;
		createdAt: string;
		acknowledgedAt: string | null;
		authorName: string;
	}

	let items = $state<FeedbackItem[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let filter = $state<'unacknowledged' | 'all'>('unacknowledged');
	let selectedId = $state<string | null>(null);
	let acknowledging = $state(false);

	const selected = $derived(items.find((i) => i.id === selectedId) ?? null);
	const visible = $derived(
		filter === 'unacknowledged' ? items.filter((i) => !i.acknowledgedAt) : items
	);
	const unacknowledgedCount = $derived(items.filter((i) => !i.acknowledgedAt).length);

	onMount(fetchFeedback);

	async function fetchFeedback() {
		isLoading = true;
		error = null;
		try {
			const res = await fetch('/api/admin/feedback');
			if (!res.ok) {
				if (res.status === 403) throw new Error('Access Denied: Admins only');
				throw new Error('Failed to fetch feedback');
			}
			const data = await res.json();
			items = Array.isArray(data.feedback) ? data.feedback : [];
		} catch (e) {
			console.error(e);
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			isLoading = false;
		}
	}

	async function acknowledge(id: string) {
		if (acknowledging) return;
		acknowledging = true;
		try {
			const res = await fetch(`/api/admin/feedback/${id}`, { method: 'PATCH' });
			if (!res.ok) throw new Error('Failed to acknowledge');
			const data = await res.json();
			items = items.map((i) =>
				i.id === id ? { ...i, acknowledgedAt: data.feedback?.acknowledgedAt ?? new Date().toISOString() } : i
			);
			badges.refresh();
		} catch (e) {
			console.error(e);
			error = e instanceof Error ? e.message : 'Failed to acknowledge';
		} finally {
			acknowledging = false;
		}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString([], {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="text-solar-50 relative flex h-full min-h-full flex-col overflow-hidden bg-solar-900/50">
	{#if isLoading && items.length === 0}
		<div class="text-solar-300 flex flex-1 items-center justify-center p-8">
			<Icon icon="svg-spinners:90-ring-with-bg" class="mr-2 h-6 w-6" />
			Loading feedback...
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center p-8 text-red-400">
			<Icon icon="tabler:alert-triangle" class="mr-2 h-6 w-6" />
			{error}
		</div>
	{:else}
		<div class="flex h-full flex-col" transition:fade>
			<div class="shrink-0 p-6 pb-2">
				<div class="flex items-center justify-between">
					<h2 class="flex items-center gap-2 text-xl font-bold">
						<Icon icon="tabler:message-2" class="text-solar-400 h-6 w-6" />
						{#if selected}
							Feedback Detail
						{:else}
							Member Feedback
							<span
								class="text-solar-400/60 ml-2 rounded-full border border-white/5 bg-solar-900/40 px-2 py-0.5 text-sm font-normal"
							>
								{unacknowledgedCount} new
							</span>
						{/if}
					</h2>
					{#if selected}
						<button
							onclick={() => (selectedId = null)}
							class="text-solar-300 hover:text-solar-100 flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors hover:bg-white/5"
						>
							<Icon icon="tabler:arrow-left" /> Back
						</button>
					{:else}
						<button
							onclick={fetchFeedback}
							class="text-solar-300 hover:text-solar-100 flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors hover:bg-white/5"
							disabled={isLoading}
						>
							<Icon icon="tabler:refresh" class={isLoading ? 'animate-spin' : ''} />
							Refresh
						</button>
					{/if}
				</div>

				{#if !selected}
					<div class="mt-3 flex gap-2">
						<button
							onclick={() => (filter = 'unacknowledged')}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors {filter ===
							'unacknowledged'
								? 'bg-indigo-500 text-white'
								: 'bg-white/5 text-solar-300 hover:bg-white/10'}"
						>
							Unacknowledged
						</button>
						<button
							onclick={() => (filter = 'all')}
							class="rounded-full px-3 py-1 text-xs font-medium transition-colors {filter === 'all'
								? 'bg-indigo-500 text-white'
								: 'bg-white/5 text-solar-300 hover:bg-white/10'}"
						>
							All
						</button>
					</div>
				{/if}
			</div>

			<div class="flex-1 overflow-auto p-6 pt-2">
				{#if selected}
					<div class="mx-auto max-w-2xl">
						<div class="mb-4 flex items-center justify-between">
							<div>
								<div class="text-solar-100 text-lg font-semibold">{selected.title}</div>
								<div class="text-solar-400/70 mt-1 text-sm">
									{selected.authorName} · {formatDate(selected.createdAt)}
								</div>
							</div>
							{#if selected.acknowledgedAt}
								<span
									class="flex items-center gap-1 rounded-full border border-green-400/20 bg-green-400/10 px-3 py-1 text-xs font-medium text-green-400"
								>
									<Icon icon="tabler:check" /> Acknowledged
								</span>
							{/if}
						</div>
						<div
							class="text-solar-100 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed whitespace-pre-wrap"
						>
							{selected.message}
						</div>
						{#if !selected.acknowledgedAt}
							<button
								onclick={() => acknowledge(selected.id)}
								disabled={acknowledging}
								class="mt-4 flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
							>
								<Icon icon="tabler:check" />
								{acknowledging ? 'Acknowledging…' : 'Acknowledge'}
							</button>
						{/if}
					</div>
				{:else if visible.length === 0}
					<div class="text-solar-400/60 flex flex-1 items-center justify-center py-12 text-sm">
						{filter === 'unacknowledged'
							? 'No unacknowledged feedback. All caught up!'
							: 'No feedback yet.'}
					</div>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each visible as item (item.id)}
							<li>
								<button
									onclick={() => (selectedId = item.id)}
									class="group flex w-full items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-4 py-3 text-left transition-colors hover:bg-white/5"
								>
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											{#if !item.acknowledgedAt}
												<span class="h-2 w-2 shrink-0 rounded-full bg-indigo-400"></span>
											{:else}
												<Icon
													icon="tabler:check"
													class="text-solar-400/40 h-3.5 w-3.5 shrink-0"
												/>
											{/if}
											<span class="text-solar-100 truncate font-medium">{item.title}</span>
										</div>
										<div class="text-solar-400/60 mt-0.5 truncate text-xs">
											{item.authorName} · {formatDate(item.createdAt)}
										</div>
									</div>
									<Icon
										icon="tabler:chevron-right"
										class="text-solar-400/40 h-4 w-4 shrink-0 group-hover:text-solar-300"
									/>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>
