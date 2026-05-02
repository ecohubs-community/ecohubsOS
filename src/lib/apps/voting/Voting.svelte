<script lang="ts">
	import { offcoin } from '$lib/offcoin.svelte';
	import { onMount } from 'svelte';
	import ProposalList from './ProposalList.svelte';
	import ProposalDetail from './ProposalDetail.svelte';
	import ProposalForm from './ProposalForm.svelte';
	import type { ProposalDetail as ProposalDetailType, ProposalListRow, TagOption } from './types';

	type View = 'list' | 'detail' | 'form';

	let view = $state<View>('list');
	let selectedId = $state<string | null>(null);

	let statusTab = $state<'active' | 'past'>('active');
	let typeFilter = $state<'' | 'operational' | 'strategic' | 'constitutional'>('');
	let tagFilter = $state('');

	let proposals = $state<ProposalListRow[]>([]);
	let isLoading = $state(false);
	let listError = $state<string | null>(null);

	let detail = $state<ProposalDetailType | null>(null);
	let detailError = $state<string | null>(null);

	let availableTags = $state<TagOption[]>([]);

	const canAuthor = $derived(offcoin.level >= 3);

	async function loadList() {
		isLoading = true;
		listError = null;
		try {
			const params = new URLSearchParams();
			params.set('status', statusTab);
			if (typeFilter) params.set('type', typeFilter);
			if (tagFilter) params.set('tag', tagFilter);
			const res = await fetch(`/api/proposals?${params.toString()}`);
			if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
			const data = await res.json();
			proposals = data.proposals;
		} catch (err) {
			listError = err instanceof Error ? err.message : 'Failed to load proposals';
		} finally {
			isLoading = false;
		}
	}

	async function loadTags() {
		try {
			const res = await fetch('/api/proposals/tags');
			if (res.ok) {
				const data = await res.json();
				availableTags = data.tags;
			}
		} catch {
			// non-critical
		}
	}

	async function loadDetail(id: string) {
		detailError = null;
		detail = null;
		try {
			const res = await fetch(`/api/proposals/${id}`);
			if (!res.ok) throw new Error(`Failed to load proposal (${res.status})`);
			const data = await res.json();
			detail = data.proposal;
		} catch (err) {
			detailError = err instanceof Error ? err.message : 'Failed to load proposal';
		}
	}

	function selectProposal(id: string) {
		selectedId = id;
		view = 'detail';
		loadDetail(id);
	}

	function backToList() {
		selectedId = null;
		detail = null;
		view = 'list';
		// The $effect below re-fetches when `view` flips back to 'list'.
	}

	function openForm() {
		view = 'form';
	}

	function onProposalCreated(id: string) {
		selectedId = id;
		view = 'detail';
		loadDetail(id);
		// list is re-fetched on next backToList via the $effect.
	}

	async function onVoted() {
		if (selectedId) await loadDetail(selectedId);
	}

	onMount(() => {
		loadTags();
	});

	// Drives the initial list load and re-fetches whenever filters change
	// or we navigate back to the list view.
	$effect(() => {
		statusTab;
		typeFilter;
		tagFilter;
		if (view === 'list') loadList();
	});
</script>

<div class="voting-root">
	{#if view === 'list'}
		<ProposalList
			{proposals}
			{isLoading}
			error={listError}
			{canAuthor}
			{statusTab}
			{typeFilter}
			{tagFilter}
			availableTags={availableTags.map((t) => t.tag)}
			onTabChange={(t) => (statusTab = t)}
			onTypeChange={(t) => (typeFilter = t)}
			onTagChange={(t) => (tagFilter = t)}
			onSelect={selectProposal}
			onNew={openForm}
			onRefresh={loadList}
		/>
	{:else if view === 'detail'}
		{#if detailError}
			<div class="centered-error">{detailError}</div>
			<button class="back-link" onclick={backToList}>Back</button>
		{:else if detail}
			<ProposalDetail proposal={detail} onBack={backToList} onVoted={onVoted} />
		{:else}
			<div class="centered-error">Loading…</div>
		{/if}
	{:else if view === 'form'}
		<ProposalForm
			availableTags={availableTags}
			onCancel={backToList}
			onCreated={onProposalCreated}
		/>
	{/if}
</div>

<style>
	.voting-root {
		height: 100%;
		overflow-y: auto;
		color: rgba(255, 255, 255, 0.92);
	}
	.centered-error {
		padding: 2rem;
		text-align: center;
		color: #fca5a5;
	}
	.back-link {
		display: block;
		margin: 0 auto;
		background: rgba(255, 255, 255, 0.08);
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		cursor: pointer;
	}
</style>
