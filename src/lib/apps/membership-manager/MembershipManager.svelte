<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { badges } from '$lib/badges.svelte';
	import HelpSection from '$lib/components/HelpSection.svelte';
	import Icon from '@iconify/svelte';
	import { fade, slide } from 'svelte/transition';
	import { obscureEmail } from '$lib/utils/email.utils';

	interface Application {
		id: string;
		fullName: string;
		email: string;
		formData: string; // JSON string containing all form fields
		status: string;
		submittedAt: string;
		snapshotProposalId: string | null;
		snapshotProposalLink: string | null;
		aiRecommendation: string | null;
		confirmationEmailSentAt: string | null;
		// Enriched fields from API
		votingStatus: 'none' | 'active' | 'closed';
		votingResult: 'approved' | 'rejected' | 'needs_review' | null;
		votingEnd: number | null;
		votingScores: number[] | null;
	}

	// Parsed form data interface (flexible to support all 41+ fields)
	interface FormData {
		fullName: string;
		email: string;
		motivation?: string;
		contribution?: string;
		location?: string;
		timeAvailability?: string;
		languages?: string;
		experienceAreas?: string;
		proudProject?: string;
		resonanceCombined?: string;
		natureCommunityMeaning?: string;
		values?: string;
		[key: string]: string | undefined; // Allow any additional fields
	}

	function parseFormData(app: Application): FormData {
		try {
			return JSON.parse(app.formData);
		} catch {
			// Fallback for legacy data or parse errors
			return { fullName: app.fullName, email: app.email };
		}
	}

	interface SnapshotConfig {
		snapshotSpace: string;
		votingDuration: number;
	}

	let applications = $state<Application[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let expandedId = $state<string | null>(null);
	let creatingProposalFor = $state<string | null>(null);
	let sendingEmailFor = $state<string | null>(null);
	let snapshotConfig = $state<SnapshotConfig | null>(null);
	let viewingApplication = $state<Application | null>(null);

	async function loadApplications() {
		isLoading = true;
		error = null;
		try {
			const response = await fetch('/api/applications');
			if (!response.ok) {
				throw new Error('Failed to load applications');
			}
			const data = await response.json();
			applications = data.applications;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load applications';
		} finally {
			isLoading = false;
		}
	}

	async function loadSnapshotConfig() {
		try {
			const response = await fetch('/api/proposals');
			if (response.ok) {
				snapshotConfig = await response.json();
			}
		} catch {
			console.error('Failed to load Snapshot config');
		}
	}

	function formatDate(dateString: string): string {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays} days ago`;
		return date.toLocaleDateString();
	}

	function formatVotingTimeRemaining(endTimestamp: number): string {
		const now = Math.floor(Date.now() / 1000);
		const remaining = endTimestamp - now;

		if (remaining <= 0) return 'Ended';

		const days = Math.floor(remaining / 86400);
		const hours = Math.floor((remaining % 86400) / 3600);
		const minutes = Math.floor((remaining % 3600) / 60);

		if (days > 0) return `${days}d ${hours}h remaining`;
		if (hours > 0) return `${hours}h ${minutes}m remaining`;
		return `${minutes}m remaining`;
	}

	function getStatusColor(app: Application): string {
		if (app.status === 'pending') return 'bg-amber-500/20 text-amber-300';
		if (app.votingStatus === 'active') return 'bg-blue-500/20 text-blue-300';
		if (app.votingStatus === 'closed') {
			if (app.votingResult === 'approved') {
				return app.confirmationEmailSentAt
					? 'bg-green-500/20 text-green-300'
					: 'bg-emerald-500/20 text-emerald-300';
			}
			if (app.votingResult === 'rejected') return 'bg-red-500/20 text-red-300';
			if (app.votingResult === 'needs_review') return 'bg-purple-500/20 text-purple-300';
		}
		// Fallback for proposal_created without Snapshot data
		if (app.status === 'proposal_created') return 'bg-blue-500/20 text-blue-300';
		return 'bg-white/10 text-white/60';
	}

	function getStatusLabel(app: Application): string {
		if (app.status === 'pending') return 'Pending Review';
		if (app.votingStatus === 'active') return 'Active Voting';
		if (app.votingStatus === 'closed') {
			if (app.votingResult === 'approved') {
				return app.confirmationEmailSentAt ? 'Approved — Email Sent' : 'Approved';
			}
			if (app.votingResult === 'rejected') return 'Rejected';
			if (app.votingResult === 'needs_review') return 'Needs Review';
			return 'Vote Closed';
		}
		// Fallback
		if (app.status === 'proposal_created') return 'Proposal Created';
		return app.status;
	}

	async function createProposal(app: Application) {
		if (!auth.isSafeOwner) {
			statusMessage = { type: 'error', text: 'Only Safe owners can create proposals' };
			return;
		}

		if (!snapshotConfig) {
			statusMessage = { type: 'error', text: 'Snapshot configuration not loaded' };
			return;
		}

		// Check for MetaMask
		if (typeof window === 'undefined' || !window.ethereum) {
			statusMessage = { type: 'error', text: 'MetaMask is required to create proposals' };
			return;
		}

		creatingProposalFor = app.id;
		statusMessage = null;

		try {
			// Request wallet connection
			const accounts = (await window.ethereum.request({
				method: 'eth_requestAccounts'
			})) as string[];
			const connectedAddress = accounts[0].toLowerCase();

			// Verify wallet matches authenticated user
			if (connectedAddress !== auth.walletAddress?.toLowerCase()) {
				throw new Error(`Please connect wallet ${auth.shortAddress}`);
			}

			// Dynamically import ethers and Snapshot SDK
			const { BrowserProvider } = await import('ethers');
			const snapshot = await import('@snapshot-labs/snapshot.js');

			const provider = new BrowserProvider(window.ethereum);
			const ethersV6Signer = await provider.getSigner();

			// Create a wrapper that adapts ethers v6 signer to v5 interface
			// Snapshot SDK expects _signTypedData (v5) but ethers v6 uses signTypedData
			const signer = {
				getAddress: () => ethersV6Signer.getAddress(),
				_signTypedData: (
					domain: Record<string, unknown>,
					types: Record<string, Array<{ name: string; type: string }>>,
					value: Record<string, unknown>
				) => ethersV6Signer.signTypedData(domain, types, value)
			};

			// Get current block number for snapshot
			const blockNumber = await provider.getBlockNumber();

			// Format proposal body
			const proposalBody = formatProposalBody(app);

			// Calculate voting times
			const now = Math.floor(Date.now() / 1000);
			const end = now + snapshotConfig.votingDuration;

			// Create and sign proposal
			const hub = 'https://hub.snapshot.org';
			const client = new snapshot.default.Client712(hub);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const receipt = (await client.proposal(signer as any, connectedAddress, {
				space: snapshotConfig.snapshotSpace,
				type: 'single-choice',
				title: `Membership Application: ${app.fullName}`,
				body: proposalBody,
				discussion: '',
				choices: ['Approve', 'Reject', 'Needs Review'],
				start: now,
				end: end,
				snapshot: blockNumber,
				plugins: JSON.stringify({}),
				app: 'ecohubs-os'
			})) as { id: string };

			const proposalId = receipt.id;
			const proposalLink = `https://snapshot.org/#/${snapshotConfig.snapshotSpace}/proposal/${proposalId}`;

			// Update application in database
			const updateResponse = await fetch('/api/proposals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					applicationId: app.id,
					snapshotProposalId: proposalId,
					snapshotProposalLink: proposalLink
				})
			});

			if (!updateResponse.ok) {
				throw new Error('Failed to update application with proposal details');
			}

			// Update local state
			const idx = applications.findIndex((a) => a.id === app.id);
			if (idx !== -1) {
				applications[idx] = {
					...applications[idx],
					status: 'proposal_created',
					snapshotProposalId: proposalId,
					snapshotProposalLink: proposalLink,
					votingStatus: 'active',
					votingEnd: end
				};
			}

			statusMessage = {
				type: 'success',
				text: `Proposal created successfully for ${app.fullName}`
			};

			// Refresh badge counts
			badges.refresh();
		} catch (err) {
			console.error('Error creating proposal:', err);
			statusMessage = {
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to create proposal'
			};
		} finally {
			creatingProposalFor = null;
		}
	}

	async function sendConfirmationEmail(app: Application) {
		if (!auth.isSafeOwner) {
			statusMessage = { type: 'error', text: 'Only Safe owners can send confirmation emails' };
			return;
		}

		sendingEmailFor = app.id;
		statusMessage = null;

		try {
			const response = await fetch(`/api/applications/${app.id}/confirm`, {
				method: 'POST'
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({ message: 'Unknown error' }));
				throw new Error(data.message || `Failed to send confirmation email (${response.status})`);
			}

			const data = await response.json();

			// Update local state
			const idx = applications.findIndex((a) => a.id === app.id);
			if (idx !== -1) {
				applications[idx] = {
					...applications[idx],
					confirmationEmailSentAt: data.sentAt
				};
			}

			// Also update the viewing application if we're in detail view
			if (viewingApplication && viewingApplication.id === app.id) {
				viewingApplication = {
					...viewingApplication,
					confirmationEmailSentAt: data.sentAt
				};
			}

			statusMessage = {
				type: 'success',
				text: `Confirmation email sent to ${app.email}`
			};

			// Refresh badge counts
			badges.refresh();
		} catch (err) {
			console.error('Error sending confirmation email:', err);
			statusMessage = {
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to send confirmation email'
			};
		} finally {
			sendingEmailFor = null;
		}
	}

	function formatProposalBody(app: Application): string {
		const data = parseFormData(app);
		const sections = [
			`## Applicant Information`,
			`- **Name:** ${data.fullName}`,
			`- **Email:** ${data.email}`,
			data.location ? `- **Location:** ${data.location}` : null,
			data.timeAvailability ? `- **Time Availability:** ${data.timeAvailability}` : null,
			data.languages ? `- **Languages:** ${data.languages}` : null,
			``,
			`## Motivation`,
			data.motivation || 'Not provided',
			``,
			`## Contribution`,
			data.contribution || 'Not provided',
			data.experienceAreas ? `\n## Experience Areas\n${data.experienceAreas}` : null,
			data.proudProject ? `\n## Proud Project\n${data.proudProject}` : null,
			data.values ? `\n## Values\n${data.values}` : null,
			data.resonanceCombined ? `\n## Resonance\n${data.resonanceCombined}` : null,
			data.natureCommunityMeaning
				? `\n## Nature & Community Meaning\n${data.natureCommunityMeaning}`
				: null,
			app.aiRecommendation ? `\n## AI Recommendation\n${app.aiRecommendation}` : null,
			``,
			`---`,
			`*Submitted: ${new Date(app.submittedAt).toLocaleString()}*`
		];

		return sections.filter(Boolean).join('\n');
	}

	function toggleExpanded(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	function formatFieldName(key: string): string {
		// Convert camelCase to Title Case with spaces
		return key
			.replace(/([A-Z])/g, ' $1')
			.replace(/^./, (str) => str.toUpperCase())
			.trim();
	}

	function viewApplication(app: Application) {
		viewingApplication = app;
	}

	function closeApplicationView() {
		viewingApplication = null;
	}

	$effect(() => {
		loadApplications();
		loadSnapshotConfig();
	});
</script>

{#snippet statusBadge(app: Application)}
	<span class="rounded-full px-2.5 py-1 text-xs font-medium {getStatusColor(app)}">
		{getStatusLabel(app)}
	</span>
	{#if app.votingStatus === 'active' && app.votingEnd}
		<span class="text-[10px] text-blue-300/70">
			{formatVotingTimeRemaining(app.votingEnd)}
		</span>
	{/if}
{/snippet}

{#snippet actionButtons(app: Application)}
	{#if app.status === 'pending'}
		<button
			type="button"
			class="flex items-center justify-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-solar-900 transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={() => createProposal(app)}
			disabled={creatingProposalFor !== null || !auth.isSafeOwner}
		>
			{#if creatingProposalFor === app.id}
				<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
				Creating...
			{:else}
				<Icon icon="tabler:rocket" class="h-4 w-4" />
				Create Proposal
			{/if}
		</button>
	{/if}
	{#if app.snapshotProposalLink}
		<a
			href={app.snapshotProposalLink}
			target="_blank"
			rel="noopener noreferrer"
			class="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
		>
			<Icon icon="tabler:external-link" class="h-4 w-4" />
			View on Snapshot
		</a>
	{/if}
	{#if app.votingResult === 'approved' && !app.confirmationEmailSentAt}
		<button
			type="button"
			class="flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={() => sendConfirmationEmail(app)}
			disabled={sendingEmailFor !== null || !auth.isSafeOwner}
		>
			{#if sendingEmailFor === app.id}
				<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
				Sending...
			{:else}
				<Icon icon="tabler:mail-forward" class="h-4 w-4" />
				Send Confirmation Email
			{/if}
		</button>
	{:else if app.confirmationEmailSentAt}
		<span
			class="flex items-center gap-2 rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-300"
		>
			<Icon icon="tabler:mail-check" class="h-4 w-4" />
			Email Sent {formatDate(app.confirmationEmailSentAt)}
		</span>
	{/if}
{/snippet}

<div class="flex h-full flex-col gap-4 p-4 md:p-6">
	{#if viewingApplication}
		<!-- Full Application Detail View -->
		{@const formData = parseFormData(viewingApplication)}
		<div class="flex h-full flex-col" transition:fade>
			<!-- Header with Back Button -->
			<div class="mb-4 flex flex-col gap-4 md:flex-row md:items-center">
				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 md:w-auto"
					onclick={closeApplicationView}
				>
					<Icon icon="tabler:arrow-left" class="h-4 w-4" />
					Back to List
				</button>
				<div class="flex items-center gap-3">
					<div
						class="from-solar-400 to-solar-600 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br font-bold text-white"
					>
						{viewingApplication.fullName[0].toUpperCase()}
					</div>
					<div>
						<h2 class="text-lg font-semibold text-white">{viewingApplication.fullName}</h2>
						<p class="text-solar-300/60 text-xs">
							{obscureEmail(viewingApplication.email)} • Submitted {formatDate(
								viewingApplication.submittedAt
							)}
						</p>
					</div>
				</div>
				<div class="ml-auto flex items-center gap-2">
					{@render statusBadge(viewingApplication)}
				</div>
			</div>

			<!-- Application Content -->
			<div class="flex-1 overflow-auto rounded-xl border border-white/10 bg-white/5 p-4 md:p-6">
				<div class="space-y-6">
					{#each Object.entries(formData) as [key, value] (key)}
						{#if value && typeof value === 'string' && value.trim()}
							<div class="border-b border-white/5 pb-4 last:border-0">
								<h3 class="text-solar-300/60 mb-2 text-xs font-semibold tracking-wider uppercase">
									{formatFieldName(key)}
								</h3>
								<div class="text-solar-100/90 text-sm leading-relaxed whitespace-pre-wrap">
									{value}
								</div>
							</div>
						{/if}
					{/each}

					{#if viewingApplication.aiRecommendation}
						<div class="border-b border-white/5 pb-4 last:border-0">
							<h3 class="text-solar-300/60 mb-2 text-xs font-semibold tracking-wider uppercase">
								AI Recommendation
							</h3>
							<div
								class="rounded-lg bg-blue-500/10 p-3 text-sm leading-relaxed whitespace-pre-wrap text-blue-200"
							>
								{viewingApplication.aiRecommendation}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Actions Footer -->
			<div class="mt-4 flex flex-col gap-2 md:flex-row">
				{@render actionButtons(viewingApplication)}
			</div>
		</div>
	{:else}
		<!-- Help Section -->
		<HelpSection appId="membership-manager" title="About this app">
			<p class="mb-2">The Membership Application Manager allows you to:</p>
			<ul class="mb-2 list-inside list-disc space-y-1">
				<li>Review pending membership applications</li>
				<li>Create Snapshot proposals for community voting</li>
				<li>Track proposal status and voting results</li>
				<li>Send confirmation emails to approved applicants</li>
			</ul>
			<p class="text-solar-300/60">
				Only Safe wallet owners can create proposals and send confirmation emails.
			</p>
		</HelpSection>

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

		<!-- Applications List -->
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
						onclick={loadApplications}
					>
						Try Again
					</button>
				</div>
			{:else if applications.length === 0}
				<div class="text-solar-300/60 rounded-lg bg-white/5 p-8 text-center">
					<Icon icon="tabler:inbox" class="mx-auto mb-2 h-12 w-12" />
					<p>No applications yet</p>
				</div>
			{:else}
				{#each applications as app (app.id)}
					<div
						class="rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/[0.07]"
					>
						<!-- Card Header -->
						<button
							type="button"
							class="flex w-full items-center justify-between p-4 text-left"
							onclick={() => toggleExpanded(app.id)}
						>
							<div class="flex items-center gap-3">
								<div
									class="from-solar-400 to-solar-600 flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br font-bold text-white"
								>
									{app.fullName[0].toUpperCase()}
								</div>
								<div>
									<h3 class="font-medium text-white">{app.fullName}</h3>
									<p class="text-solar-300/60 text-xs">
										{obscureEmail(app.email)} • {formatDate(app.submittedAt)}
									</p>
								</div>
							</div>
							<div class="flex items-center gap-3">
								{@render statusBadge(app)}
								<Icon
									icon={expandedId === app.id ? 'tabler:chevron-up' : 'tabler:chevron-down'}
									class="text-solar-300/60 h-5 w-5"
								/>
							</div>
						</button>

						<!-- Expanded Content -->
						{#if expandedId === app.id}
							{@const formData = parseFormData(app)}
							<div class="border-t border-white/10 p-4" transition:slide>
								<!-- Motivation Preview -->
								{#if formData.motivation}
									<div class="mb-4">
										<h4 class="text-solar-300/60 mb-1 text-xs font-medium uppercase">Motivation</h4>
										<p class="text-solar-100/80 text-sm">
											{formData.motivation.length > 200
												? formData.motivation.slice(0, 200) + '...'
												: formData.motivation}
										</p>
									</div>
								{/if}

								<!-- Contribution Preview -->
								{#if formData.contribution}
									<div class="mb-4">
										<h4 class="text-solar-300/60 mb-1 text-xs font-medium uppercase">
											Contribution
										</h4>
										<p class="text-solar-100/80 text-sm">
											{formData.contribution.length > 200
												? formData.contribution.slice(0, 200) + '...'
												: formData.contribution}
										</p>
									</div>
								{/if}

								<!-- Additional Info -->
								{#if formData.location || formData.languages}
									<div class="text-solar-300/60 mb-4 flex flex-wrap gap-2 text-xs">
										{#if formData.location}
											<span class="flex items-center gap-1">
												<Icon icon="tabler:map-pin" class="h-3 w-3" />
												{formData.location}
											</span>
										{/if}
										{#if formData.languages}
											<span class="flex items-center gap-1">
												<Icon icon="tabler:language" class="h-3 w-3" />
												{formData.languages}
											</span>
										{/if}
									</div>
								{/if}

								<!-- Actions -->
								<div class="flex flex-col flex-wrap gap-2 md:flex-row">
									<button
										type="button"
										class="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
										onclick={() => viewApplication(app)}
									>
										<Icon icon="tabler:eye" class="h-4 w-4" />
										View Full Application
									</button>
									{@render actionButtons(app)}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
