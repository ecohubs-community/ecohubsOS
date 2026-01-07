<script lang="ts">
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';

	let status = $state<'idle' | 'loading' | 'error'>('idle');
	let errorMessage = $state('');
	let joinUrl = $state<string | null>(null);
	let alreadyMember = $state(false);
	let workspaceUrl = $state<string | null>(null);

	async function handleJoin() {
		status = 'loading';
		errorMessage = '';

		try {
			const response = await fetch('/api/puckstack/invitation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				throw new Error(data.error || 'Failed to generate invitation');
			}

			if (data.alreadyMember) {
				alreadyMember = true;
				workspaceUrl = data.workspaceUrl;
				// Mark the onboarding step as completed
				markSubStepCompletedById('puckstack-signup');
			} else if (data.joinUrl) {
				joinUrl = data.joinUrl;
				// Open the join URL in a new tab
				window.open(data.joinUrl, '_blank', 'noopener,noreferrer');
				status = 'idle';
			} else {
				throw new Error('No join URL returned');
			}
		} catch (error) {
			status = 'error';
			errorMessage = error instanceof Error ? error.message : 'Something went wrong';
		}
	}

	function openGenericJoin() {
		window.open('https://puckstack.xyz/join', '_blank', 'noopener,noreferrer');
	}

	function openWorkspace() {
		if (workspaceUrl) {
			window.open(workspaceUrl, '_blank', 'noopener,noreferrer');
		}
	}

	function markComplete() {
		markSubStepCompletedById('puckstack-signup');
		os.closeApp();
	}
</script>

<div class="flex h-full flex-col p-6">
	<div class="mb-6 text-center">
		<div
			class="from-emerald-400 to-teal-400 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br"
		>
			<Icon icon="tabler:checklist" class="h-8 w-8 text-emerald-900" />
		</div>
		<h2 class="text-xl font-bold text-white">Join ecohubs on Puckstack</h2>
		<p class="text-solar-300 mt-2 text-sm">
			Puckstack is where ecohubs members collaborate on tasks, earn ECO tokens, and level up through
			contributions.
		</p>
	</div>

	{#if alreadyMember}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">Already a Member!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				You're already part of the ecohubs workspace on Puckstack.
			</p>
			<button
				onclick={openWorkspace}
				class="mt-6 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
			>
				<Icon icon="tabler:external-link" class="h-4 w-4" />
				Open ecohubs Workspace
			</button>
			<button onclick={markComplete} class="text-solar-300 mt-4 text-sm underline hover:text-white">
				Continue to next step
			</button>
		</div>
	{:else if joinUrl}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:external-link" class="mb-4 h-16 w-16 text-emerald-400" />
			<h3 class="text-lg font-bold text-white">Join Link Ready</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				A new tab should have opened. Complete your sign-up there, then come back here.
			</p>
			<button
				onclick={() => window.open(joinUrl!, '_blank', 'noopener,noreferrer')}
				class="mt-6 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
			>
				<Icon icon="tabler:external-link" class="h-4 w-4" />
				Open Link Again
			</button>
			<button onclick={markComplete} class="text-solar-300 mt-4 text-sm underline hover:text-white">
				I've joined, continue
			</button>
		</div>
	{:else}
		<div class="flex-1 space-y-4">
			<div class="rounded-xl bg-white/5 p-4">
				<h4 class="text-solar-200 mb-3 text-sm font-medium">What you'll get:</h4>
				<ul class="text-solar-300 space-y-2 text-sm">
					<li class="flex items-start gap-2">
						<Icon icon="tabler:check" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
						<span>Access to community tasks and bounties</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="tabler:check" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
						<span>Earn ECO tokens for completed work</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="tabler:check" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
						<span>Level up and unlock achievements</span>
					</li>
					<li class="flex items-start gap-2">
						<Icon icon="tabler:check" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
						<span>Collaborate on quests with other members</span>
					</li>
				</ul>
			</div>

			{#if status === 'error' && errorMessage}
				<div
					class="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<div>
						<span>{errorMessage}</span>
						<button
							onclick={openGenericJoin}
							class="mt-2 block text-xs underline hover:text-red-100"
						>
							Try manual sign-up instead
						</button>
					</div>
				</div>
			{/if}
		</div>

		<button
			onclick={handleJoin}
			disabled={status === 'loading'}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-medium text-white transition-all hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if status === 'loading'}
				<Icon icon="tabler:loader" class="h-5 w-5 animate-spin" />
				Preparing your invitation...
			{:else}
				<Icon icon="tabler:rocket" class="h-5 w-5" />
				Join ecohubs Workspace
			{/if}
		</button>

		<button
			onclick={openGenericJoin}
			class="text-solar-400 mt-3 text-center text-xs hover:text-white"
		>
			Already have an account? Sign in to Puckstack
		</button>
	{/if}
</div>
