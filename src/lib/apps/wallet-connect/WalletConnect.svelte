<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { wallet } from '$lib/wallet.svelte';
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	let status = $state<'idle' | 'connecting' | 'saving' | 'success' | 'error'>('idle');
	let errorMessage = $state('');

	onMount(() => {
		wallet.checkMetaMask();
	});

	async function handleConnect() {
		if (!wallet.hasMetaMask) {
			errorMessage = 'MetaMask is not installed';
			status = 'error';
			return;
		}

		status = 'connecting';
		errorMessage = '';

		const address = await wallet.connect();

		if (!address) {
			errorMessage = wallet.error || 'Failed to connect wallet';
			status = 'error';
			return;
		}

		status = 'saving';
		const success = await wallet.saveToProfile(address);

		if (success) {
			status = 'success';
			// Update the auth store so downstream components see the wallet address
			if (auth.user) {
				auth.setUser({ ...auth.user, walletAddress: address });
			}
			markSubStepCompletedById('wallet-connect');
			window.dispatchEvent(new CustomEvent('onboarding-step-completed'));
			setTimeout(() => os.closeApp(), 2000);
		} else {
			errorMessage = wallet.error || 'Failed to save wallet to profile';
			status = 'error';
		}
	}
</script>

<div class="flex h-full flex-col p-6">
	<div class="mb-6 text-center">
		<div
			class="from-solar-400 to-gold-400 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br"
		>
			<Icon icon="tabler:link" class="text-solar-900 h-8 w-8" />
		</div>
		<h2 class="text-xl font-bold text-white">Connect Your Wallet</h2>
		<p class="text-solar-300 mt-2 text-sm">
			Link your MetaMask wallet to your ecohubsOS account for voting and blockchain features.
		</p>
	</div>

	{#if status === 'success'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Wallet Connected!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Your wallet is now linked to your account.
			</p>
			<div class="mt-4 rounded-xl bg-white/5 px-4 py-2">
				<span class="font-mono text-sm text-white/70">{wallet.address}</span>
			</div>
		</div>
	{:else if auth.walletAddress}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Already Connected</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				Your wallet is already linked to your account.
			</p>
			<div class="mt-4 rounded-xl bg-white/5 px-4 py-2">
				<span class="font-mono text-sm text-white/70">{auth.shortWalletAddress}</span>
			</div>
		</div>
		<button
			onclick={() => {
				markSubStepCompletedById('wallet-connect');
				os.closeApp();
			}}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-500 font-medium text-white transition-all hover:bg-green-400 active:scale-95"
		>
			<Icon icon="tabler:check" class="h-5 w-5" />
			Continue
		</button>
	{:else}
		<div class="flex-1 space-y-4">
			{#if status === 'error' && errorMessage}
				<div
					class="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}

			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">Your Account</h4>
				<p class="text-sm text-white">{auth.userName}</p>
				<p class="text-xs text-white/50">{auth.userEmail}</p>
			</div>

			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-2 text-sm font-medium">What happens next:</h4>
				<ul class="space-y-1 text-xs text-white/70">
					<li>1. MetaMask will ask you to connect</li>
					<li>2. Your wallet address will be linked to your account</li>
					<li>3. You can participate in Snapshot voting</li>
				</ul>
			</div>
		</div>

		<button
			onclick={handleConnect}
			disabled={status === 'connecting' || status === 'saving'}
			class="text-solar-900 mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 font-medium transition-all hover:bg-amber-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if status === 'connecting'}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
				Connecting...
			{:else if status === 'saving'}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
				Saving...
			{:else}
				<Icon icon="tabler:wallet" class="h-5 w-5" />
				Connect MetaMask
			{/if}
		</button>
	{/if}
</div>
