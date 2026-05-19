<script lang="ts">
	import Icon from '@iconify/svelte';
	import MarkdownView from './MarkdownView.svelte';
	import VoteModal from './VoteModal.svelte';
	import type { ProposalDetail } from './types';

	interface Props {
		proposal: ProposalDetail;
		onBack: () => void;
		onVoted: () => void | Promise<void>;
	}

	let { proposal, onBack, onVoted }: Props = $props();

	let modalChoice = $state<string | null>(null);
	let inlineError = $state<string | null>(null);

	function fmtAbsolute(iso: string): string {
		return new Date(iso).toLocaleString();
	}

	function fmtCountdown(iso: string): string {
		const ms = new Date(iso).getTime() - Date.now();
		if (ms <= 0) return 'now';
		const day = 24 * 60 * 60 * 1000;
		const hour = 60 * 60 * 1000;
		const min = 60 * 1000;
		if (ms >= day) return `${Math.round(ms / day)}d`;
		if (ms >= hour) return `${Math.round(ms / hour)}h`;
		if (ms >= min) return `${Math.round(ms / min)}m`;
		return '<1m';
	}

	const TOTAL = $derived(proposal.votesTotal);

	function pct(choice: string): number {
		if (TOTAL === 0) return 0;
		return Math.round(((proposal.votesByChoice[choice] ?? 0) / TOTAL) * 100);
	}

	const canVote = $derived(proposal.status === 'active' && !proposal.userHasVoted);

	async function submitVote(reason: string) {
		if (!modalChoice) return;
		const res = await fetch(`/api/proposals/${proposal.id}/vote`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ choice: modalChoice, reason: reason || undefined })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.message || `Vote failed (${res.status})`);
		}
		modalChoice = null;
		await onVoted();
	}
</script>

<div class="detail-root">
	<button class="back-btn" onclick={onBack}>
		<Icon icon="tabler:chevron-left" class="h-4 w-4" />
		Back to proposals
	</button>

	<div class="head">
		<div class="head-pills">
			<span class="type-pill type-{proposal.type}">{proposal.type}</span>
			{#each proposal.tags as tag}
				<span class="tag-pill">#{tag}</span>
			{/each}
		</div>
		<h1>{proposal.title}</h1>
		<div class="head-meta">
			<span>Created {fmtAbsolute(proposal.createdAt)}</span>
			{#if proposal.status === 'deliberating'}
				<span>· Voting opens {fmtAbsolute(proposal.voteOpensAt)} (in {fmtCountdown(proposal.voteOpensAt)})</span>
			{:else if proposal.status === 'active'}
				<span>· Voting closes {fmtAbsolute(proposal.voteClosesAt)} (in {fmtCountdown(proposal.voteClosesAt)})</span>
			{:else if proposal.status === 'ratifying' && proposal.ratificationEndsAt}
				<span>· Ratifies on {fmtAbsolute(proposal.ratificationEndsAt)}</span>
			{:else if proposal.status === 'withdrawn' && proposal.withdrawnAt}
				<span>· Withdrawn {fmtAbsolute(proposal.withdrawnAt)}</span>
			{:else}
				<span>· Closed {fmtAbsolute(proposal.voteClosesAt)}</span>
			{/if}
		</div>
	</div>

	{#if proposal.status === 'withdrawn'}
		<div class="withdrawn-callout">
			<div class="withdrawn-head">
				<Icon icon="tabler:ban" class="h-4 w-4" />
				<span>Proposal withdrawn by an admin</span>
			</div>
			{#if proposal.withdrawalReason}
				<p class="withdrawn-reason">{proposal.withdrawalReason}</p>
			{:else}
				<p class="withdrawn-reason muted">No reason provided.</p>
			{/if}
		</div>
	{/if}

	<section class="body-section">
		<MarkdownView source={proposal.body} />
	</section>

	<section class="vote-section">
		<h2>
			{#if proposal.status === 'deliberating'}
				Voting hasn't opened yet
			{:else if proposal.status === 'active'}
				Cast your vote
			{:else if proposal.status === 'withdrawn'}
				Withdrawn — voting was cancelled
			{:else}
				Outcome
			{/if}
		</h2>

		{#if proposal.status === 'deliberating'}
			<p class="hint">
				This proposal is in its deliberation period. Discuss it in the forum or on Discord. Voting
				opens in {fmtCountdown(proposal.voteOpensAt)}.
			</p>
		{/if}

		{#if proposal.status === 'closed' || proposal.status === 'ratifying' || proposal.status === 'ratified'}
			{#if proposal.result === 'approved'}
				<p class="result result-pass">
					✅ Approved
					{#if proposal.status === 'ratifying'} — in 30-day ratification period{/if}
				</p>
			{:else if proposal.result === 'rejected'}
				<p class="result result-fail">❌ Rejected</p>
			{:else if proposal.result === 'needs_review'}
				<p class="result result-review">🔍 Needs Review</p>
			{:else if proposal.result === 'tied'}
				<p class="result result-fail">⚖️ Tied — proposal failed; status quo holds.</p>
			{/if}
		{/if}

		{#if proposal.userHasVoted && proposal.status === 'active'}
			<p class="hint">You have already voted on this proposal.</p>
		{/if}

		{#if inlineError}
			<div class="error-banner">{inlineError}</div>
		{/if}

		<div class="tally">
			{#each proposal.choices as choice}
				{@const count = proposal.votesByChoice[choice] ?? 0}
				{@const percent = pct(choice)}
				<div class="tally-row">
					<button
						class="choice-btn"
						disabled={!canVote}
						onclick={() => (modalChoice = choice)}
					>
						{choice}
					</button>
					<div class="bar-wrap" aria-label={`${count} votes (${percent}%)`}>
						<div class="bar" style="width: {percent}%"></div>
					</div>
					<div class="tally-count">{count} ({percent}%)</div>
				</div>
			{/each}
		</div>

		<div class="totals">{TOTAL} {TOTAL === 1 ? 'vote' : 'votes'} cast</div>
	</section>

	<section class="voters-section">
		<h2>Voters</h2>
		{#if proposal.voters.length === 0}
			<p class="hint">No votes yet.</p>
		{:else}
			<ul class="voters">
				{#each proposal.voters as v (v.userId + ':' + v.votedAt)}
					<li class="voter">
						<div class="voter-head">
							<span class="voter-name">{v.displayName}</span>
							<span class="voter-choice">voted <strong>{v.choice}</strong></span>
							<span class="voter-time">{fmtAbsolute(v.votedAt)}</span>
						</div>
						{#if v.reason}
							<p class="voter-reason">{v.reason}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<VoteModal
	choice={modalChoice ?? ''}
	open={modalChoice !== null}
	onCancel={() => (modalChoice = null)}
	onConfirm={submitVote}
/>

<style>
	.detail-root {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		padding: 1rem 1.2rem 2rem;
	}
	.back-btn {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.3rem 0.4rem;
	}
	.back-btn:hover {
		color: white;
	}
	.head h1 {
		margin: 0.4rem 0 0.6rem;
		font-size: 1.4rem;
	}
	.head-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.head-meta {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.5);
	}
	.body-section {
		padding: 1rem 1.2rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
	}
	.vote-section,
	.voters-section {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.vote-section h2,
	.voters-section h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.85rem;
	}
	.result {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
	}
	.result-pass {
		color: #86efac;
	}
	.result-fail {
		color: #fda4af;
	}
	.result-review {
		color: #fcd34d;
	}
	.withdrawn-callout {
		background: rgba(113, 113, 122, 0.12);
		border: 1px solid rgba(113, 113, 122, 0.35);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.withdrawn-head {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: #d4d4d8;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.withdrawn-reason {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.85);
		white-space: pre-wrap;
	}
	.withdrawn-reason.muted {
		color: rgba(255, 255, 255, 0.5);
		font-style: italic;
	}
	.tally {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.tally-row {
		display: grid;
		grid-template-columns: 9rem 1fr 6rem;
		align-items: center;
		gap: 0.7rem;
	}
	.choice-btn {
		background: rgba(99, 102, 241, 0.18);
		border: 1px solid rgba(99, 102, 241, 0.35);
		color: #c7d2fe;
		padding: 0.45rem 0.8rem;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.choice-btn:hover:not(:disabled) {
		background: rgba(99, 102, 241, 0.28);
	}
	.choice-btn:disabled {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.4);
		cursor: not-allowed;
	}
	.bar-wrap {
		height: 8px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar {
		height: 100%;
		background: linear-gradient(90deg, rgba(129, 140, 248, 0.65), rgba(99, 102, 241, 0.85));
		transition: width 0.3s;
	}
	.tally-count {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.6);
		text-align: right;
	}
	.totals {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.45);
	}
	.voters {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.voter {
		padding: 0.6rem 0.9rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
	}
	.voter-head {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}
	.voter-name {
		font-weight: 500;
	}
	.voter-choice {
		color: rgba(255, 255, 255, 0.65);
	}
	.voter-time {
		color: rgba(255, 255, 255, 0.4);
		margin-left: auto;
	}
	.voter-reason {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.75);
		font-style: italic;
	}
	.error-banner {
		padding: 0.6rem 0.8rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.type-pill,
	.tag-pill {
		display: inline-flex;
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
</style>
