<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';
	import { onMount, onDestroy } from 'svelte';

	type Status =
		| 'loading'
		| 'no_wallet'
		| 'not_proposed'
		| 'pending'
		| 'confirmed'
		| 'executed'
		| 'already_owner'
		| 'delegate_added'
		| 'error';

	let status = $state<Status>('loading');
	let errorMessage = $state('');
	let errorDetails = $state<Record<string, unknown> | null>(null);
	let safeTxHash = $state<string | null>(null);
	let confirmations = $state(0);
	let threshold = $state(0);
	let safeUrl = $state<string | null>(null);
	let isProposing = $state(false);
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	async function checkStatus() {
		try {
			const response = await fetch('/api/safe/status');
			const data = await response.json();

			status = data.status as Status;
			errorMessage = data.status === 'error' ? (data.message || 'An error occurred') : '';
			errorDetails = data.status === 'error' ? (data.details || null) : null;
			safeTxHash = data.safeTxHash || null;
			confirmations = data.confirmations || 0;
			threshold = data.threshold || 0;
			safeUrl = data.safeUrl || null;

			if (status === 'executed' || status === 'delegate_added') {
				markSubStepCompletedById('safe-proposal');
				stopPolling();
			}
		} catch (err) {
			console.error('Error checking status:', err);
			status = 'error';
			errorMessage = 'Failed to check status';
		}
	}

	async function requestMembership() {
		isProposing = true;
		errorMessage = '';
		errorDetails = null;

		try {
			const response = await fetch('/api/safe/propose', { method: 'POST' });
			const data = await response.json();

			if (!response.ok) {
				status = 'error';
				errorMessage = data.message || 'Failed to submit proposal';
				errorDetails = data.details || null;
				return;
			}

			status = data.status as Status;
			safeTxHash = data.safeTxHash || null;
			errorDetails = null;

			if (status === 'already_owner' || status === 'executed' || status === 'delegate_added') {
				markSubStepCompletedById('safe-proposal');
			} else if (status === 'pending') {
				startPolling();
			}
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : 'Failed to submit proposal';
			errorDetails = null;
		} finally {
			isProposing = false;
		}
	}

	function startPolling() {
		if (pollInterval) return;
		pollInterval = setInterval(checkStatus, 30000); // Check every 30 seconds
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}

	function openSafeApp() {
		if (safeUrl) {
			window.open(safeUrl, '_blank', 'noopener,noreferrer');
		}
	}

	onMount(() => {
		checkStatus();
	});

	onDestroy(() => {
		stopPolling();
	});

	$effect(() => {
		if (status === 'pending') {
			startPolling();
		}
	});
</script>

<div class="flex h-full flex-col p-6">
	<div class="mb-6 text-center">
		<div
			class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-400"
		>
			<Icon icon="tabler:shield-check" class="h-8 w-8 text-emerald-900" />
		</div>
		<h2 class="text-xl font-bold text-white">Safe Access</h2>
		<p class="text-solar-300 mt-2 text-sm">
			Request access to the community Safe for governance participation.
		</p>
	</div>

	{#if status === 'loading'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-12 w-12 animate-spin text-white/60" />
			<p class="mt-4 text-white/60">Checking status...</p>
		</div>
	{:else if status === 'no_wallet'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:wallet-off" class="mb-4 h-16 w-16 text-amber-400" />
			<h3 class="text-lg font-bold text-white">Wallet Required</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Please connect your wallet first before requesting Safe membership.
			</p>
		</div>
	{:else if status === 'executed'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">You're a Safe Owner!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				You can confirm and execute Safe transactions.
			</p>
		</div>
		<button
			onclick={() => os.closeApp()}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-500 font-medium text-white transition-all hover:bg-green-400 active:scale-95"
		>
			<Icon icon="tabler:check" class="h-5 w-5" />
			Continue
		</button>
	{:else if status === 'delegate_added'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">You're a Safe Proposer!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				You can propose transactions, but cannot confirm or execute them.
			</p>
		</div>
		<button
			onclick={() => os.closeApp()}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-500 font-medium text-white transition-all hover:bg-green-400 active:scale-95"
		>
			<Icon icon="tabler:check" class="h-5 w-5" />
			Continue
		</button>
	{:else if status === 'pending'}
		<div class="flex flex-1 flex-col items-center justify-center space-y-4">
			<div class="relative">
				<Icon icon="tabler:hourglass" class="h-16 w-16 text-amber-400" />
				<div
					class="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white"
				>
					{confirmations}/{threshold}
				</div>
			</div>
			<h3 class="text-lg font-bold text-white">Awaiting Approval</h3>
			<p class="text-solar-300 text-center text-sm">
				Your request has been submitted. Waiting for {threshold - confirmations} more
				confirmation(s) from Safe owners.
			</p>

			{#if safeTxHash}
				<div class="w-full rounded-xl bg-white/5 p-4">
					<p class="mb-2 text-xs text-white/50">Transaction Hash</p>
					<p class="break-all font-mono text-xs text-white/70">{safeTxHash}</p>
				</div>
			{/if}
		</div>

		<div class="mt-6 flex gap-3">
			<button
				onclick={checkStatus}
				class="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 font-medium text-white transition-all hover:bg-white/20"
			>
				<Icon icon="tabler:refresh" class="h-5 w-5" />
				Refresh
			</button>
			{#if safeUrl}
				<button
					onclick={openSafeApp}
					class="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 font-medium text-white transition-all hover:bg-white/5"
				>
					<Icon icon="tabler:external-link" class="h-5 w-5" />
					View in Safe
				</button>
			{/if}
		</div>
	{:else if status === 'confirmed'}
		<div class="flex flex-1 flex-col items-center justify-center space-y-4">
			<Icon icon="tabler:circle-check" class="h-16 w-16 text-emerald-400" />
			<h3 class="text-lg font-bold text-white">Proposal Confirmed!</h3>
			<p class="text-solar-300 text-center text-sm">
				All required confirmations received. The transaction can now be executed.
			</p>
		</div>

		<div class="mt-6 flex gap-3">
			<button
				onclick={checkStatus}
				class="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 font-medium text-white transition-all hover:bg-white/20"
			>
				<Icon icon="tabler:refresh" class="h-5 w-5" />
				Refresh
			</button>
			{#if safeUrl}
				<button
					onclick={openSafeApp}
					class="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 font-medium text-white transition-all hover:bg-white/5"
				>
					<Icon icon="tabler:external-link" class="h-5 w-5" />
					View in Safe
				</button>
			{/if}
		</div>
	{:else if status === 'error'}
		<div class="flex flex-1 flex-col items-center justify-center space-y-4">
			<Icon icon="tabler:alert-circle" class="h-16 w-16 text-red-400" />
			<h3 class="text-lg font-bold text-white">Error</h3>
			<p class="text-center text-sm text-red-200">
				{errorMessage || 'An error occurred'}
			</p>
			{#if errorDetails}
				<div class="w-full rounded-xl bg-white/5 p-4">
					<p class="mb-2 text-xs text-white/50">Details</p>
					<pre class="max-h-48 overflow-auto text-xs text-white/70">{JSON.stringify(errorDetails, null, 2)}</pre>
				</div>
			{/if}
		</div>
		<button
			onclick={checkStatus}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/10 font-medium text-white transition-all hover:bg-white/20"
		>
			<Icon icon="tabler:refresh" class="h-5 w-5" />
			Try Again
		</button>
	{:else}
		<!-- not_proposed -->
		<div class="flex-1 space-y-4">
			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">Your Wallet</h4>
				<p class="break-all font-mono text-xs text-white/70">
					{auth.walletAddress}
				</p>
			</div>

			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">What is Safe Access?</h4>
				<ul class="space-y-1 text-xs text-white/70">
					<li>- Get access in the Safe app as an owner or proposer</li>
					<li>- Proposers can suggest transactions</li>
					<li>- Owners review, approve, and execute transactions</li>
				</ul>
			</div>

			<div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
				<h4 class="mb-2 text-sm font-medium text-amber-200">Approval Required</h4>
				<p class="text-xs text-amber-200/70">
					Your request will be reviewed by existing Safe owners. Once approved you will have access to the Safe.
				</p>
			</div>
		</div>

		<button
			onclick={requestMembership}
			disabled={isProposing}
			class="text-solar-900 mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 font-medium transition-all hover:bg-emerald-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if isProposing}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
				Submitting Request...
			{:else}
				<Icon icon="tabler:shield-plus" class="h-5 w-5" />
				Request Safe Access
			{/if}
		</button>
	{/if}
</div>
