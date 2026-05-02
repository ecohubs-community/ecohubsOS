<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { ProposalListRow } from './types';

	interface Props {
		proposals: ProposalListRow[];
		isLoading: boolean;
		error: string | null;
		canAuthor: boolean;
		statusTab: 'active' | 'past';
		typeFilter: '' | 'operational' | 'strategic' | 'constitutional';
		tagFilter: string;
		availableTags: string[];
		onTabChange: (tab: 'active' | 'past') => void;
		onTypeChange: (type: '' | 'operational' | 'strategic' | 'constitutional') => void;
		onTagChange: (tag: string) => void;
		onSelect: (id: string) => void;
		onNew: () => void;
		onRefresh: () => void;
	}

	let {
		proposals,
		isLoading,
		error,
		canAuthor,
		statusTab,
		typeFilter,
		tagFilter,
		availableTags,
		onTabChange,
		onTypeChange,
		onTagChange,
		onSelect,
		onNew,
		onRefresh
	}: Props = $props();

	function formatRelative(iso: string): string {
		const date = new Date(iso);
		const ms = date.getTime() - Date.now();
		const abs = Math.abs(ms);
		const day = 24 * 60 * 60 * 1000;
		const hour = 60 * 60 * 1000;
		const min = 60 * 1000;
		const inFuture = ms > 0;
		let value: string;
		if (abs >= day) value = `${Math.round(abs / day)}d`;
		else if (abs >= hour) value = `${Math.round(abs / hour)}h`;
		else if (abs >= min) value = `${Math.round(abs / min)}m`;
		else value = 'now';
		return inFuture ? `in ${value}` : `${value} ago`;
	}

	function statusLabel(p: ProposalListRow): { text: string; color: string } {
		if (p.status === 'deliberating') return { text: 'Deliberating', color: 'amber' };
		if (p.status === 'active') return { text: 'Voting open', color: 'indigo' };
		if (p.status === 'ratifying') return { text: 'Ratifying', color: 'sky' };
		if (p.status === 'ratified') return { text: 'Ratified', color: 'emerald' };
		if (p.status === 'withdrawn') return { text: 'Withdrawn', color: 'gray' };
		// closed
		if (p.result === 'approved') return { text: 'Approved', color: 'emerald' };
		if (p.result === 'rejected') return { text: 'Rejected', color: 'rose' };
		if (p.result === 'needs_review') return { text: 'Needs Review', color: 'amber' };
		if (p.result === 'tied') return { text: 'Tied (failed)', color: 'rose' };
		return { text: 'Closed', color: 'gray' };
	}
</script>

<div class="list-root">
	<div class="header">
		<div class="tabs">
			<button class="tab" class:active={statusTab === 'active'} onclick={() => onTabChange('active')}>
				Active
			</button>
			<button class="tab" class:active={statusTab === 'past'} onclick={() => onTabChange('past')}>
				Past
			</button>
		</div>

		<div class="filters">
			<select
				class="filter-select"
				value={typeFilter}
				onchange={(e) => onTypeChange((e.currentTarget as HTMLSelectElement).value as Props['typeFilter'])}
			>
				<option value="">All types</option>
				<option value="operational">Operational</option>
				<option value="strategic">Strategic</option>
				<option value="constitutional">Constitutional</option>
			</select>

			<select
				class="filter-select"
				value={tagFilter}
				onchange={(e) => onTagChange((e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">All tags</option>
				{#each availableTags as tag}
					<option value={tag}>{tag}</option>
				{/each}
			</select>

			<button class="icon-btn" onclick={onRefresh} title="Refresh">
				<Icon icon="tabler:refresh" class="h-4 w-4" />
			</button>

			{#if canAuthor}
				<button class="btn-primary" onclick={onNew}>
					<Icon icon="tabler:plus" class="h-4 w-4" />
					New Proposal
				</button>
			{/if}
		</div>
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if isLoading}
		<div class="empty-state">Loading proposals…</div>
	{:else if proposals.length === 0}
		<div class="empty-state">
			{statusTab === 'active' ? 'No active proposals.' : 'No past proposals.'}
		</div>
	{:else}
		<ul class="proposal-list">
			{#each proposals as p (p.id)}
				{@const label = statusLabel(p)}
				<li>
					<button class="proposal-row" onclick={() => onSelect(p.id)}>
						<div class="row-main">
							<div class="row-title">
								<span class="title">{p.title}</span>
								{#if p.userHasVoted}
									<span class="voted-pill">
										<Icon icon="tabler:check" class="h-3 w-3" />
										voted
									</span>
								{/if}
							</div>
							<div class="row-meta">
								<span class="type-pill type-{p.type}">{p.type}</span>
								{#each p.tags.slice(0, 4) as tag}
									<span class="tag-pill">#{tag}</span>
								{/each}
								{#if p.tags.length > 4}
									<span class="tag-pill">+{p.tags.length - 4}</span>
								{/if}
							</div>
						</div>
						<div class="row-side">
							<span class="status-pill status-{label.color}">{label.text}</span>
							<span class="row-time">
								{#if p.status === 'deliberating'}
									opens {formatRelative(p.voteOpensAt)}
								{:else if p.status === 'active'}
									closes {formatRelative(p.voteClosesAt)}
								{:else if p.status === 'ratifying' && p.ratificationEndsAt}
									ratifies {formatRelative(p.ratificationEndsAt)}
								{:else}
									{p.votesTotal} {p.votesTotal === 1 ? 'vote' : 'votes'}
								{/if}
							</span>
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.list-root {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.2rem 1.4rem;
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.8rem;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 9px;
		padding: 0.2rem;
	}
	.tab {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		padding: 0.4rem 0.9rem;
		border-radius: 7px;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
	}
	.tab.active {
		color: white;
		background: rgba(99, 102, 241, 0.25);
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.filter-select {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: white;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		font-size: 0.85rem;
	}
	.icon-btn {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.7);
		padding: 0.4rem;
		border-radius: 8px;
		cursor: pointer;
	}
	.icon-btn:hover {
		color: white;
		background: rgba(255, 255, 255, 0.1);
	}
	.btn-primary {
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
	}
	.btn-primary:hover {
		background: rgb(79, 82, 221);
	}
	.error-banner {
		padding: 0.6rem 0.9rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.empty-state {
		padding: 2rem 0;
		text-align: center;
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
	}
	.proposal-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.proposal-row {
		width: 100%;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 10px;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}
	.proposal-row:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.14);
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.title {
		font-weight: 500;
		font-size: 0.95rem;
		color: rgba(255, 255, 255, 0.95);
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.row-side {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.35rem;
		flex-shrink: 0;
	}
	.row-time {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.45);
	}
	.type-pill,
	.tag-pill,
	.status-pill,
	.voted-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 500;
		text-transform: capitalize;
	}
	.type-pill {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.75);
	}
	.type-operational {
		color: #93c5fd;
	}
	.type-strategic {
		color: #c4b5fd;
	}
	.type-constitutional {
		color: #fca5a5;
	}
	.tag-pill {
		background: rgba(99, 102, 241, 0.1);
		color: rgba(199, 210, 254, 0.85);
	}
	.voted-pill {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
	}
	.status-pill {
		text-transform: none;
	}
	.status-amber {
		background: rgba(251, 191, 36, 0.15);
		color: #fcd34d;
	}
	.status-indigo {
		background: rgba(99, 102, 241, 0.18);
		color: #c7d2fe;
	}
	.status-sky {
		background: rgba(14, 165, 233, 0.18);
		color: #7dd3fc;
	}
	.status-emerald {
		background: rgba(34, 197, 94, 0.15);
		color: #86efac;
	}
	.status-rose {
		background: rgba(244, 63, 94, 0.15);
		color: #fda4af;
	}
	.status-gray {
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.55);
	}
</style>
