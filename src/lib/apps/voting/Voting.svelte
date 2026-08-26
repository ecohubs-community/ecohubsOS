<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { os } from '$lib/os.svelte';
	import { DISCORD_URL } from '$lib/contributions/contributionData';
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

	// Authorship is a role now, not an Offcoin level. Members author operational
	// proposals themselves; the strategic and constitutional types stay with
	// stewards and admins, which the form enforces on the type picker.
	//
	// Trial members still see the button — it opens an invitation to bring the
	// idea to Discord rather than vanishing, so the path forward is visible.
	const canAuthor = $derived(auth.can('proposal.create').allowed);
	const canAuthorGovernance = $derived(auth.can('proposal.create.governance').allowed);

	// Vote eligibility is resolved in ProposalDetail, next to the ballot it gates.
	let showProposeHint = $state(false);

	// Close only on the backdrop itself, so a click inside the card doesn't
	// dismiss it — avoids a stopPropagation handler on a non-interactive element.
	function closeHintOnBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) showProposeHint = false;
	}

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

	// React to deep-link payloads addressed to the voting app. Triggered
	// both on first mount and whenever another app calls os.openApp('voting', ...).
	$effect(() => {
		const target = os.consumeDeepLink<{ proposalId: string }>('voting');
		if (target?.proposalId) selectProposal(target.proposalId);
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
			onProposeBlocked={() => (showProposeHint = true)}
			onRefresh={loadList}
		/>
	{:else if view === 'detail'}
		{#if detailError}
			<div class="centered-error">{detailError}</div>
			<button class="back-link" onclick={backToList}>Back</button>
		{:else if detail}
			<ProposalDetail proposal={detail} onBack={backToList} {onVoted} />
		{:else}
			<div class="centered-error">Loading…</div>
		{/if}
	{:else if view === 'form'}
		<ProposalForm
			{availableTags}
			{canAuthorGovernance}
			onCancel={backToList}
			onCreated={onProposalCreated}
		/>
	{/if}
</div>

{#if showProposeHint}
	<!-- Trial members can't author yet, but the idea still has a home. This
	     points them at the discussion rather than showing them a dead end. -->
	<div
		class="hint-backdrop"
		role="dialog"
		aria-modal="true"
		aria-label="Proposing an idea"
		tabindex="-1"
		onclick={closeHintOnBackdrop}
		onkeydown={(e) => e.key === 'Escape' && (showProposeHint = false)}
	>
		<div class="hint-card">
			<h3>Got an idea for ecohubs?</h3>
			<p>
				Great that you want to propose something to make ecohubs a better place. We're happy to hear
				all your ideas and critiques — please post a new discussion thread on Discord and we'll go
				from there, creating your proposal when it aligns with our manifesto and vision.
			</p>
			<div class="hint-actions">
				<button class="btn-secondary" onclick={() => (showProposeHint = false)}>Close</button>
				<button
					class="btn-primary"
					onclick={() => window.open(DISCORD_URL, '_blank', 'noopener,noreferrer')}
				>
					Open Discord
				</button>
			</div>
		</div>
	</div>
{/if}

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

	.hint-backdrop {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(4px);
		padding: 1.5rem;
		z-index: 20;
	}
	.hint-card {
		max-width: 30rem;
		background: rgb(24, 30, 38);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		padding: 1.4rem 1.5rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	}
	.hint-card h3 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
		font-weight: 600;
		color: white;
	}
	.hint-card p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.75);
	}
	.hint-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.2rem;
	}
	.hint-actions .btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: rgb(99, 102, 241);
		color: white;
		border: none;
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
	}
	.hint-actions .btn-primary:hover {
		background: rgb(79, 82, 221);
	}
	.hint-actions .btn-secondary {
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.8);
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.hint-actions .btn-secondary:hover {
		background: rgba(255, 255, 255, 0.14);
	}
</style>
