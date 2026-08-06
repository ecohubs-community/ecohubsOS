<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';
	import { badges } from '$lib/badges.svelte';
	import {
		type OnboardingCard as Card,
		type DraftEmail,
		emailKindMeta,
		STAGE_META,
		STAGE_ORDER
	} from './types';
	import OnboardingCard from './OnboardingCard.svelte';
	import MemberDetailModal from './MemberDetailModal.svelte';
	import DraftEmailCard from './DraftEmailCard.svelte';
	import DraftEmailModal from './DraftEmailModal.svelte';

	let cards = $state<Card[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let selectedId = $state<string | null>(null);
	let backfilling = $state(false);

	let drafts = $state<DraftEmail[]>([]);
	let selectedDraft = $state<DraftEmail | null>(null);

	// Most urgent first: a suspension notice must not sit behind three
	// "we've missed you" nudges — the member it concerns is locked out.
	const sortedDrafts = $derived(
		[...drafts].sort((a, b) => emailKindMeta(a.kind).urgency - emailKindMeta(b.kind).urgency)
	);

	async function loadDrafts() {
		try {
			const res = await fetch('/api/member-emails');
			if (res.ok) {
				const data = await res.json();
				drafts = Array.isArray(data.emails) ? data.emails : [];
			}
		} catch {
			// Non-critical: the board itself still works without the queue.
		}
	}

	const byStage = $derived(
		STAGE_ORDER.map((stage) => ({
			stage,
			meta: STAGE_META[stage],
			cards: cards.filter((c) => c.stage === stage)
		}))
	);

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/onboarding-board');
			if (!res.ok) throw new Error('Failed to load board');
			const data = await res.json();
			cards = data.cards ?? [];
			await loadDrafts();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load board';
		} finally {
			loading = false;
		}
	}

	async function backfill() {
		if (backfilling) return;
		backfilling = true;
		try {
			await fetch('/api/admin/onboarding-backfill', { method: 'POST' });
			await load();
			badges.refresh();
		} finally {
			backfilling = false;
		}
	}

	function onUpdated() {
		load();
		badges.refresh();
	}

	function onDraftHandled() {
		loadDrafts();
		badges.refresh();
	}

	onMount(load);
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
		<div>
			<h1 class="text-base font-semibold text-white">Member Onboarding</h1>
			<p class="text-xs text-white/40">Guide new members from accepted to fully onboarded.</p>
		</div>
		<div class="flex items-center gap-2">
			{#if auth.isAdmin}
				<button
					type="button"
					onclick={backfill}
					disabled={backfilling}
					class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40"
					title="Create cards for existing accepted members"
				>
					<Icon
						icon="tabler:database-import"
						class="h-4 w-4 {backfilling ? 'animate-pulse' : ''}"
					/>
					Sync existing
				</button>
			{/if}
			<button
				type="button"
				onclick={load}
				class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
			>
				<Icon icon="tabler:refresh" class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
				Refresh
			</button>
		</div>
	</div>

	{#if sortedDrafts.length > 0}
		<!-- Emails the system has drafted and nobody has decided on yet. These sit
		     above the board because they are a to-do, not a pipeline stage — and
		     because a member is waiting on the other end of each one. -->
		<div class="border-b border-white/10 bg-white/[0.02] px-4 py-3">
			<div class="mb-2 flex items-center gap-2">
				<Icon icon="tabler:mail-cog" class="h-4 w-4 text-white/50" />
				<h2 class="text-sm font-medium text-white">Emails waiting for you</h2>
				<span class="rounded-md bg-white/10 px-1.5 text-xs text-white/50">
					{sortedDrafts.length}
				</span>
			</div>
			<p class="mb-2.5 text-[11px] text-white/30">
				Nothing here has been sent. Open one to read it, reword it, and decide.
			</p>
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each sortedDrafts as draft (draft.id)}
					<div class="w-72 shrink-0">
						<DraftEmailCard {draft} onclick={() => (selectedDraft = draft)} />
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if loading && cards.length === 0}
		<div class="flex flex-1 items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-8 w-8 animate-spin text-white/40" />
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-300">{error}</p>
		</div>
	{:else if cards.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
			<Icon icon="tabler:users-group" class="h-10 w-10 text-white/20" />
			<p class="text-sm text-white/50">No members in the onboarding pipeline yet.</p>
			{#if auth.isAdmin}
				<p class="text-xs text-white/30">Use “Sync existing” to add already-accepted members.</p>
			{/if}
		</div>
	{:else}
		<!-- Kanban -->
		<div class="flex flex-1 gap-3 overflow-x-auto p-4">
			{#each byStage as col (col.stage)}
				<div class="flex w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
					<div class="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
						<div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full {col.meta.dotClass}"></span>
							<span class="text-sm font-medium text-white">{col.meta.label}</span>
							<span class="rounded-md bg-white/10 px-1.5 text-xs text-white/50">
								{col.cards.length}
							</span>
						</div>
					</div>
					<p class="px-3 pt-2 text-[11px] text-white/30">{col.meta.hint}</p>
					<div class="flex-1 space-y-2 overflow-y-auto p-3">
						{#each col.cards as card (card.id)}
							<OnboardingCard {card} onclick={() => (selectedId = card.id)} />
						{/each}
						{#if col.cards.length === 0}
							<p class="px-1 py-4 text-center text-xs text-white/20">Empty</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if selectedDraft}
	{#key selectedDraft.id}
		<DraftEmailModal
			draft={selectedDraft}
			onClose={() => (selectedDraft = null)}
			onDone={onDraftHandled}
		/>
	{/key}
{/if}

{#if selectedId}
	{#key selectedId}
		<MemberDetailModal onboardingId={selectedId} onClose={() => (selectedId = null)} {onUpdated} />
	{/key}
{/if}
