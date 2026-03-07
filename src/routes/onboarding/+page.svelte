<script lang="ts">
	import OnboardingWizard from '$lib/components/OnboardingWizard.svelte';
	import { auth } from '$lib/auth.svelte';

	let { data } = $props();

	// Initialize auth store with server data so inline app components
	// (e.g. OffcoinConnect) can access walletAddress, safeOwnerStatus, etc.
	$effect(() => {
		if (data.user) {
			auth.setUser(data.user);
		}
	});
</script>

<svelte:head>
	<title>Setup - ecohubsOS</title>
	<meta name="description" content="Set up your ecohubsOS account" />
</svelte:head>

<div class="fixed inset-0 flex flex-col bg-solar-900">
	<!-- Background gradients (matching login page) -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div
			class="absolute top-[-10%] left-[-10%] h-[50%] w-[50%] animate-pulse rounded-full bg-solar-500/10 blur-[120px]"
		></div>
		<div
			class="absolute right-[-10%] bottom-[-10%] h-[50%] w-[50%] animate-pulse rounded-full bg-gold-500/10 blur-[120px] delay-1000"
		></div>
		<div
			class="absolute top-[30%] left-[60%] h-[30%] w-[30%] animate-pulse rounded-full bg-emerald-500/5 blur-[100px] delay-500"
		></div>
	</div>

	<!-- Header -->
	<header
		class="relative z-10 flex h-10 shrink-0 items-center justify-between bg-black/20 px-4 text-xs font-medium text-solar-100/80 backdrop-blur-md md:h-8"
	>
		<span class="font-bold">ecohubsOS</span>
		<span class="text-solar-100/50">Account Setup</span>
	</header>

	<!-- Content -->
	<div class="relative z-10 flex-1 overflow-y-auto">
		<OnboardingWizard
			serverProgress={data.onboardingProgress}
			userName={data.user.name}
		/>
	</div>
</div>
