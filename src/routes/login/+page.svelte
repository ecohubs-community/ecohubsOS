<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { Fingerprint, Wallet, AlertCircle, LoaderCircle, Shield } from 'lucide-svelte';

	let loading = $state(false);
	let error = $state('');
	let walletAddress = $state('');

	async function connectAndAuth() {
		loading = true;
		error = '';

		try {
			// Check if MetaMask is installed
			if (typeof window.ethereum === 'undefined') {
				throw new Error('Please install MetaMask to continue');
			}

			// Request account access
			const accounts = (await window.ethereum.request({
				method: 'eth_requestAccounts'
			})) as string[];

			if (!accounts || accounts.length === 0) {
				throw new Error('No accounts found');
			}

			walletAddress = accounts[0];

			// Create message to sign
			const message = `Sign this message to authenticate as a Safe owner.\n\nTimestamp: ${Date.now()}`;

			// Request signature
			const signature = (await window.ethereum.request({
				method: 'personal_sign',
				params: [message, walletAddress]
			})) as string;

			// Verify with backend
			const response = await fetch('/api/auth/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: walletAddress, signature, message })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.message || 'Authentication failed');
			}

			// Success! Redirect to desktop
			goto('/');
		} catch (err) {
			console.error('Auth error:', err);
			error = err instanceof Error ? err.message : 'Authentication failed';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Login - ecohubsOS</title>
	<meta name="description" content="Login to ecohubsOS - Regenerative Community Operating System" />
</svelte:head>

<div class="fixed inset-0 flex items-center justify-center bg-solar-900">
	<!-- Background gradients -->
	<div class="absolute inset-0 overflow-hidden">
		<div
			class="bg-solar-500/10 absolute top-[-10%] left-[-10%] h-[50%] w-[50%] animate-pulse rounded-full blur-[120px]"
		></div>
		<div
			class="bg-gold-500/10 absolute right-[-10%] bottom-[-10%] h-[50%] w-[50%] animate-pulse rounded-full blur-[120px] delay-1000"
		></div>
	</div>

	<div
		class="relative z-10 flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl backdrop-blur-2xl"
		in:fly={{ y: 20, duration: 800, delay: 200 }}
	>
		<!-- Logo -->
		<div
			class="from-solar-400 shadow-solar-500/20 mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-tr to-gold-400 shadow-lg"
		>
			<Fingerprint class="text-solar-900" size={32} />
		</div>

		<!-- Title -->
		<div class="space-y-1">
			<h1
				class="bg-linear-to-r from-emerald-400 to-amber-200 bg-clip-text text-3xl font-bold text-transparent"
			>
				ecohubsOS
			</h1>
			<p class="text-solar-100/60 text-sm">Regenerative Community Operating System</p>
		</div>

		<!-- Error message -->
		{#if error}
			<div
				class="flex w-full items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200"
			>
				<AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0" />
				<span>{error}</span>
			</div>
		{/if}

		<!-- Connected address indicator -->
		{#if walletAddress && !error}
			<div
				class="flex w-full items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
			>
				<Wallet class="h-4 w-4 flex-shrink-0" />
				<span class="font-mono"
					>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span
				>
			</div>
		{/if}

		<!-- Login button -->
		<div class="w-full space-y-3 pt-2">
			<button
				onclick={connectAndAuth}
				disabled={loading}
				class="group flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 font-medium text-white transition-all hover:bg-white/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if loading}
					<LoaderCircle class="h-5 w-5 animate-spin" />
					Authenticating...
				{:else}
					<Shield class="h-5 w-5" />
					Connect Wallet & Verify
				{/if}
			</button>

			<p class="text-solar-100/40 text-xs">Only Safe owners can access this system</p>
		</div>
	</div>
</div>
