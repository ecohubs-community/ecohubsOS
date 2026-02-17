<script lang="ts">
	import { wallet } from '$lib/wallet.svelte';
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	let status = $state<'checking' | 'detected' | 'not-found'>('checking');

	onMount(async () => {
		// Check if MetaMask is installed
		wallet.checkMetaMask();

		if (wallet.hasMetaMask) {
			// Check if already has connected account
			const existingAccount = await wallet.checkExistingConnection();
			if (existingAccount) {
				status = 'detected';
				// Auto-complete this step
				markSubStepCompletedById('wallet-setup');
				setTimeout(() => os.closeApp(), 1500);
			} else {
				status = 'detected';
			}
		} else {
			status = 'not-found';
		}
	});

	function openMetaMaskDownload() {
		window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
	}

	function recheckMetaMask() {
		wallet.checkMetaMask();
		if (wallet.hasMetaMask) {
			status = 'detected';
		}
	}
</script>

<div class="flex h-full flex-col p-6">
	<div class="mb-6 text-center">
		<div
			class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-400"
		>
			<Icon icon="tabler:wallet" class="h-8 w-8 text-orange-900" />
		</div>
		<h2 class="text-xl font-bold text-white">Setup MetaMask Wallet</h2>
	</div>

	{#if status === 'checking'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-12 w-12 animate-spin text-white/60" />
			<p class="mt-4 text-white/60">Checking for MetaMask...</p>
		</div>
	{:else if status === 'detected'}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">MetaMask Detected!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				You already have MetaMask installed. You can proceed to connect your wallet.
			</p>
		</div>
		<button
			onclick={markDone}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-500 font-medium text-white transition-all hover:bg-green-400 active:scale-95"
		>
			<Icon icon="tabler:check" class="h-5 w-5" />
			Continue
		</button>
	{:else if status === 'not-found'}
		<div class="flex-1 space-y-4">
			<div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
				<h4 class="mb-2 font-medium text-amber-200">MetaMask Not Found</h4>
				<p class="text-sm text-amber-200/70">
					To participate in voting and connect to blockchain features, you need MetaMask installed.
				</p>
			</div>

			<div class="space-y-3">
				<h4 class="font-medium text-white">How to get started:</h4>
				<ol class="list-inside list-decimal space-y-2 text-sm text-white/70">
					<li>Click the button below to download MetaMask</li>
					<li>Install the browser extension</li>
					<li>Create a new wallet or import an existing one</li>
					<li>Return here and click "I have MetaMask"</li>
				</ol>
			</div>

			<button
				onclick={openMetaMaskDownload}
				class="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 font-medium text-white transition-all hover:bg-orange-400"
			>
				<Icon icon="tabler:download" class="h-5 w-5" />
				Download MetaMask
				<Icon icon="tabler:external-link" class="h-4 w-4" />
			</button>
		</div>

		<div class="mt-6 flex gap-3">
			<button
				onclick={recheckMetaMask}
				class="h-12 flex-1 rounded-xl bg-white/10 font-medium text-white transition-all hover:bg-white/20"
			>
				I have MetaMask
			</button>
		</div>
	{/if}
</div>
