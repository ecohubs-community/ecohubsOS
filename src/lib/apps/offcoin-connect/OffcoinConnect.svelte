<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { offcoin } from '$lib/offcoin.svelte';
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';

	let puckstackUserId = $state('');
	let status = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
	let errorMessage = $state('');

	async function handleConnect() {
		if (!puckstackUserId.trim()) {
			errorMessage = 'Please enter your Puckstack User ID';
			status = 'error';
			return;
		}

		if (!auth.walletAddress) {
			errorMessage = 'No wallet connected';
			status = 'error';
			return;
		}

		status = 'loading';
		errorMessage = '';

		const success = await offcoin.connect(puckstackUserId.trim(), auth.walletAddress);

		if (success) {
			status = 'success';
			// Mark the onboarding step as completed
			markSubStepCompletedById('offcoin-connect');
			// Close the app after a short delay
			setTimeout(() => {
				os.closeApp();
			}, 2000);
		} else {
			status = 'error';
			errorMessage = offcoin.error || 'Connection failed';
		}
	}

	function openPuckstackSettings() {
		window.open('https://puckstack.xyz/settings', '_blank', 'noopener,noreferrer');
	}
</script>

<div class="flex h-full flex-col p-6">
	<div class="mb-6 text-center">
		<div
			class="from-solar-400 to-gold-400 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br"
		>
			<Icon icon="tabler:link" class="text-solar-900" />
		</div>
		<h2 class="text-xl font-bold text-white">Connect to Offcoin</h2>
		<p class="text-solar-300 mt-2 text-sm">
			Link your wallet to your Puckstack account to unlock XP, levels, and ECO rewards.
		</p>
	</div>

	{#if status === 'success'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Connected!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Your wallet is now linked to Offcoin. You can view your XP and ECO in the header.
			</p>
		</div>
	{:else if offcoin.isConnected}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Already Connected</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Your wallet is linked to Offcoin as <span class="font-semibold">{offcoin.name}</span>.
			</p>
			<div class="mt-4 rounded-xl bg-white/5 p-4 text-center">
				<div class="text-solar-100 text-2xl font-bold">{offcoin.xp} XP</div>
				<div class="text-solar-300 text-sm">Level {offcoin.level} • {offcoin.eco} ECO</div>
			</div>
			<button
				onclick={() => offcoin.disconnect()}
				class="text-solar-300 mt-6 text-sm underline hover:text-white"
			>
				Disconnect
			</button>
		</div>
	{:else}
		<div class="flex-1 space-y-4">
			<div>
				<label for="puckstack-id" class="text-solar-200 mb-2 block text-sm font-medium">
					Puckstack User ID
				</label>
				<input
					id="puckstack-id"
					type="text"
					bind:value={puckstackUserId}
					placeholder="e.g., UCVZAlPq2mTGC1QJlAbZvRVuR6GhejkR"
					disabled={status === 'loading'}
					class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-solar-400 focus:outline-none focus:ring-1 focus:ring-solar-400 disabled:opacity-50"
				/>
				<button
					onclick={openPuckstackSettings}
					class="text-solar-300 mt-2 flex items-center gap-1 text-xs hover:text-white"
				>
					Find your User ID in Puckstack Settings
					<Icon icon="tabler:external-link" class="h-3 w-3" />
				</button>
			</div>

			{#if status === 'error' && errorMessage}
				<div
					class="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}

			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">Your Wallet</h4>
				<p class="font-mono text-xs text-white/70">
					{auth.walletAddress ?? 'Not connected'}
				</p>
			</div>
		</div>

		<button
			onclick={handleConnect}
			disabled={status === 'loading' || !puckstackUserId.trim()}
			class="mt-6 flex h-12 w-full bg-amber-400 items-center justify-center gap-2 rounded-xl bg-solar-400 font-medium text-solar-900 transition-all hover:bg-solar-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if status === 'loading'}
				<Icon icon="tabler:loader" class="h-5 w-5 animate-spin" />
				Connecting...
			{:else}
				<Icon icon="tabler:link" class="h-5 w-5" />
				Connect Wallet to Offcoin
			{/if}
		</button>
	{/if}
</div>
