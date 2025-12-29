<script lang="ts">
	import { blur, fly } from 'svelte/transition';
	import { ArrowRight, Fingerprint } from 'lucide-svelte';
	import { os } from '$lib/os.svelte';

	let loading = $state(false);

	async function handleLogin() {
		loading = true;
		// Simulate Offcoin Auth delay
		await new Promise((r) => setTimeout(r, 1200));
		os.login();
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center"
	transition:blur={{ duration: 500 }}
>
	<div class="absolute inset-0 overflow-hidden bg-solar-900">
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
		<div
			class="from-solar-400 shadow-solar-500/20 mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-tr to-gold-400 shadow-lg"
		>
			<Fingerprint class="text-solar-900" size={32} />
		</div>

		<div class="space-y-1">
			<h1
				class="bg-linear-to-r from-emerald-400 to-amber-200 bg-clip-text text-3xl font-bold text-transparent"
			>
				ecohubsOS
			</h1>
			<p class="text-solar-100/60 text-sm">Regenerative Community Operating System</p>
		</div>

		<div class="w-full space-y-3 pt-4">
			<button
				onclick={handleLogin}
				disabled={loading}
				class="group flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 font-medium text-white transition-all hover:bg-white/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if loading}
					<span class="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
					></span>
					Authenticating...
				{:else}
					Connect Wallet / Identity <ArrowRight
						size={16}
						class="transition-transform group-hover:translate-x-1"
					/>
				{/if}
			</button>
			<p class="text-solar-100/40 text-xs">Powered by Offcoin Protocol</p>
		</div>
	</div>
</div>
