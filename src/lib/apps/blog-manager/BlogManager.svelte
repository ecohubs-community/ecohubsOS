<script lang="ts">
	import HelpSection from '$lib/components/HelpSection.svelte';
	import Icon from '@iconify/svelte';
	import { fade, slide } from 'svelte/transition';
	import { os } from '$lib/os.svelte';

	interface DraftWithProposal {
		id: string;
		slug: string;
		title: string;
		excerpt: string;
		author: string;
		updated_at: string;
		tags?: string[];
		proposalId: string | null;
		proposalStatus: 'none' | 'active' | 'closed';
		isApproved: boolean;
		proposalEnd?: number;
	}

	let drafts = $state<DraftWithProposal[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let creating = $state<string | null>(null);
	let publishing = $state<string | null>(null);

	async function loadDrafts() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch('/api/blog/drafts');
			if (!response.ok) {
				throw new Error('Failed to load blog drafts');
			}
			const data = await response.json();
			drafts = data.drafts;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load blog drafts';
		} finally {
			isLoading = false;
		}
	}

	function openProposal(proposalId: string) {
		os.openApp('voting', { proposalId });
	}

	function formatDate(dateString: string): string {
		try {
			return new Date(dateString).toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return dateString;
		}
	}

	function formatVotingEnd(endTimestamp: number): string {
		const endDate = new Date(endTimestamp * 1000);
		const now = new Date();
		const diff = endDate.getTime() - now.getTime();

		if (diff <= 0) {
			return 'Voting ended';
		}

		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

		if (days > 0) {
			return `${days} day${days > 1 ? 's' : ''} remaining`;
		}
		return `${hours} hour${hours > 1 ? 's' : ''} remaining`;
	}

	function getGhostEditUrl(draftId: string): string {
		return `https://blog.ecohubs.community/ghost/#/editor/post/${draftId}`;
	}

	function getStatusColor(status: 'none' | 'active' | 'closed', isApproved: boolean): string {
		if (status === 'none') {
			return 'bg-white/10 text-white/60';
		}
		if (status === 'active') {
			return 'bg-blue-500/20 text-blue-300';
		}
		// closed
		return isApproved ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300';
	}

	function getStatusLabel(status: 'none' | 'active' | 'closed', isApproved: boolean): string {
		if (status === 'none') {
			return 'No Proposal';
		}
		if (status === 'active') {
			return 'Voting Active';
		}
		return isApproved ? 'Approved' : 'Rejected';
	}

	async function createProposal(draft: DraftWithProposal) {
		creating = draft.id;
		statusMessage = null;
		try {
			const response = await fetch(`/api/blog/drafts/${draft.id}/proposal`, {
				method: 'POST'
			});
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || `Failed (${response.status})`);
			}
			const data = await response.json();
			drafts = drafts.map((d) =>
				d.id === draft.id
					? { ...d, proposalId: data.proposal.id, proposalStatus: 'active' as const }
					: d
			);
			statusMessage = { type: 'success', text: 'Proposal created successfully!' };
		} catch (err) {
			statusMessage = {
				type: 'error',
				text: `Failed to create proposal: ${err instanceof Error ? err.message : 'Unknown error'}`
			};
		} finally {
			creating = null;
		}
	}

	async function publishDraft(draft: DraftWithProposal) {
		if (!draft.proposalId) {
			statusMessage = { type: 'error', text: 'No proposal found for this draft' };
			return;
		}

		publishing = draft.id;
		statusMessage = null;

		try {
			const response = await fetch(`/api/blog/drafts/${draft.id}/publish`, {
				method: 'POST'
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.message || 'Failed to publish draft');
			}

			// Remove from drafts list (it's now published)
			drafts = drafts.filter((d) => d.id !== draft.id);

			statusMessage = { type: 'success', text: 'Draft published successfully!' };
			publishing = null;
		} catch (err) {
			statusMessage = {
				type: 'error',
				text: `Failed to publish: ${err instanceof Error ? err.message : 'Unknown error'}`
			};
			publishing = null;
		}
	}

	$effect(() => {
		loadDrafts();
	});
</script>

<div class="flex h-full flex-col gap-4 p-4 md:p-6">
	<!-- Header with Ghost Link -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
		<HelpSection appId="blog-manager" title="About Blog Manager">
			<p class="mb-2">The Blog Manager allows you to:</p>
			<ul class="mb-2 list-inside list-disc space-y-1">
				<li>View all pending blog drafts from Ghost CMS</li>
				<li>Create proposals for community voting on publication</li>
				<li>Track voting status and results</li>
				<li>Publish approved drafts to the blog</li>
			</ul>
			<p class="text-solar-300/60">
				Only authenticated users can manage drafts.
			</p>
		</HelpSection>
		<a
			href="https://blog.ecohubs.community/ghost/"
			target="_blank"
			rel="noopener noreferrer"
			class="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
		>
			<Icon icon="tabler:pencil-plus" class="h-4 w-4" />
			Write New Draft
		</a>
	</div>

	<!-- Status Message -->
	{#if statusMessage}
		<div
			class="flex items-center gap-2 rounded-lg p-3 {statusMessage.type === 'success'
				? 'bg-green-500/20 text-green-300'
				: 'bg-red-500/20 text-red-300'}"
			transition:fade
		>
			<Icon
				icon={statusMessage.type === 'success' ? 'tabler:check' : 'tabler:alert-circle'}
				class="h-5 w-5"
			/>
			{statusMessage.text}
			<button
				type="button"
				class="ml-auto hover:opacity-70"
				onclick={() => (statusMessage = null)}
			>
				<Icon icon="tabler:x" class="h-4 w-4" />
			</button>
		</div>
	{/if}

	<!-- Drafts List -->
	<div class="flex-1 space-y-3 overflow-auto">
		{#if isLoading}
			<div class="flex items-center justify-center py-12">
				<Icon icon="tabler:loader-2" class="text-solar-300 h-8 w-8 animate-spin" />
			</div>
		{:else if error}
			<div class="rounded-lg bg-red-500/20 p-4 text-center text-red-300">
				<Icon icon="tabler:alert-circle" class="mx-auto mb-2 h-8 w-8" />
				<p>{error}</p>
				<button
					type="button"
					class="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
					onclick={loadDrafts}
				>
					Try Again
				</button>
			</div>
		{:else if drafts.length === 0}
			<div class="text-solar-300/60 rounded-lg bg-white/5 p-8 text-center">
				<Icon icon="tabler:file-text" class="mx-auto mb-2 h-12 w-12" />
				<p>No drafts found</p>
				<p class="mt-1 text-sm">Create drafts in Ghost CMS to see them here.</p>
			</div>
		{:else}
			{#each drafts as draft (draft.id)}
				<div
					class="rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/[0.07]"
					transition:slide
				>
					<!-- Header -->
					<div class="mb-3 flex items-start justify-between">
						<div class="flex-1">
							<div class="mb-1 flex items-center gap-3">
								<h3 class="font-medium text-white">{draft.title}</h3>
								<span
									class="rounded-full px-2.5 py-0.5 text-xs font-medium {getStatusColor(
										draft.proposalStatus,
										draft.isApproved
									)}"
								>
									{getStatusLabel(draft.proposalStatus, draft.isApproved)}
								</span>
							</div>
							<p class="text-solar-300/60 text-xs">
								By {draft.author} • Updated {formatDate(draft.updated_at)}
							</p>
							{#if draft.proposalStatus === 'active' && draft.proposalEnd}
								<p class="mt-1 flex items-center gap-1 text-xs text-blue-400">
									<Icon icon="tabler:clock" class="h-3 w-3" />
									{formatVotingEnd(draft.proposalEnd)}
								</p>
							{/if}
						</div>
					</div>

					<!-- Excerpt -->
					{#if draft.excerpt}
						<p class="text-solar-100/70 mb-3 line-clamp-2 text-sm">{draft.excerpt}</p>
					{/if}

					<!-- Tags -->
					{#if draft.tags && draft.tags.length > 0}
						<div class="mb-3 flex flex-wrap gap-1">
							{#each draft.tags as tag}
								<span class="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">
									{tag}
								</span>
							{/each}
						</div>
					{/if}

					<!-- Actions -->
					<div class="flex flex-wrap gap-2">
						<a
							href={getGhostEditUrl(draft.id)}
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
						>
							<Icon icon="tabler:edit" class="h-4 w-4" />
							Edit in Ghost
						</a>
						{#if draft.proposalStatus === 'none'}
							<button
								type="button"
								onclick={() => createProposal(draft)}
								disabled={creating !== null}
								class="bg-yellow-500 text-solar-900 hover:bg-yellow-00 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
							>
								{#if creating === draft.id}
									<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
									Creating...
								{:else}
									<Icon icon="tabler:file-plus" class="h-4 w-4" />
									Create Proposal
								{/if}
							</button>
						{:else if draft.proposalId}
							<button
								type="button"
								onclick={() => draft.proposalId && openProposal(draft.proposalId)}
								class="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
							>
								<Icon icon="tabler:external-link" class="h-4 w-4" />
								View Proposal
							</button>
						{/if}

						{#if draft.isApproved && draft.proposalStatus === 'closed'}
							<button
								type="button"
								onclick={() => publishDraft(draft)}
								disabled={publishing !== null}
								class="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{#if publishing === draft.id}
									<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
									Publishing...
								{:else}
									<Icon icon="tabler:send" class="h-4 w-4" />
									Publish
								{/if}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
