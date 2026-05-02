<script lang="ts">
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';

	type Status = 'idle' | 'loading' | 'error' | 'pending-return';

	let status = $state<Status>('idle');
	let verifying = $state(false);
	let errorMessage = $state('');
	let joinUrl = $state<string | null>(null);
	let alreadyMember = $state(false);
	let workspaceUrl = $state<string | null>(null);
	let puckstackUserId = $state<string | null>(null);

	function markCompleteAndClose() {
		markSubStepCompletedById('puckstack-signup');
		// `puckstack-copy-id` is retired but historical onboarding flows
		// still reference it — mark it complete too so existing in-progress
		// users don't get stuck on it.
		markSubStepCompletedById('puckstack-copy-id');
		os.closeApp();
	}

	async function handleJoin() {
		status = 'loading';
		errorMessage = '';

		try {
			// The server reads the user's stored invite token from the DB,
			// so the client doesn't need to track or pass it.
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
				puckstackUserId = data.puckstackUserId ?? null;
				status = 'idle';
				if (puckstackUserId) {
					markSubStepCompletedById('puckstack-signup');
					markSubStepCompletedById('puckstack-copy-id');
				}
			} else if (data.joinUrl) {
				joinUrl = data.joinUrl;
				window.open(data.joinUrl, '_blank', 'noopener,noreferrer');
				status = 'pending-return';
			} else {
				throw new Error('No join URL returned');
			}
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : 'Something went wrong';
		}
	}

	/**
	 * Called after the user reports they've completed Puckstack signup.
	 * Re-hits the proxy — Puckstack should now report alreadyMember=true
	 * and we capture the User ID + auto-complete both substeps.
	 */
	async function verifyMembership() {
		verifying = true;
		errorMessage = '';
		try {
			const response = await fetch('/api/puckstack/invitation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const data = await response.json();

			if (!response.ok || !data.success) {
				throw new Error(data.error || 'Verification failed');
			}

			if (data.alreadyMember && data.puckstackUserId) {
				puckstackUserId = data.puckstackUserId;
				alreadyMember = true;
				workspaceUrl = data.workspaceUrl;
				markSubStepCompletedById('puckstack-signup');
				markSubStepCompletedById('puckstack-copy-id');
				status = 'idle';
			} else if (data.alreadyMember) {
				// User is on Puckstack but we couldn't extract their ID — fall
				// back gracefully: at least mark signup done.
				alreadyMember = true;
				workspaceUrl = data.workspaceUrl;
				markSubStepCompletedById('puckstack-signup');
				status = 'idle';
				errorMessage =
					"You're a member but we couldn't auto-detect your Puckstack User ID. Please copy it manually from your Puckstack profile.";
			} else if (data.joinUrl) {
				// Invitation was re-issued (e.g. previous one expired). Server
				// has already persisted the new token; we just update the
				// joinUrl so the "Reopen invitation link" button is fresh.
				joinUrl = data.joinUrl;
				status = 'pending-return';
				errorMessage =
					"Your previous invitation link expired — we issued a fresh one. Please open it and accept the invitation.";
			} else {
				errorMessage =
					"We couldn't find your Puckstack account yet. Please complete signup in the other tab and try again.";
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Verification failed';
		} finally {
			verifying = false;
		}
	}

	function openGenericJoin() {
		window.open('https://puckstack.xyz/join', '_blank', 'noopener,noreferrer');
	}

	// On mount: probe the server. If the user is already linked, we
	// short-circuit to the "you're a member" view; if a stored invitation
	// is still pending, we land directly in pending-return so the user
	// sees the explainer + Verify button instead of the initial Join CTA.
	async function bootstrap() {
		try {
			const response = await fetch('/api/puckstack/invitation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const data = await response.json();
			if (!response.ok || !data.success) return; // stay on idle, fall through to manual
			if (data.alreadyMember) {
				alreadyMember = true;
				workspaceUrl = data.workspaceUrl;
				puckstackUserId = data.puckstackUserId ?? null;
				if (puckstackUserId) {
					markSubStepCompletedById('puckstack-signup');
					markSubStepCompletedById('puckstack-copy-id');
				}
			} else if (data.joinUrl) {
				// Stored invitation is still pending — surface the verify view
				// without re-opening the join tab automatically.
				joinUrl = data.joinUrl;
				status = 'pending-return';
			}
		} catch {
			// Network blip on bootstrap — leave the user on the idle CTA.
		}
	}

	// While we're waiting for the user to come back from the Puckstack tab,
	// auto-verify on window focus. This collapses the happy path to a single
	// ecohubsOS click — the user accepts the invite on Puckstack, switches
	// back, and verification runs silently.
	onMount(() => {
		bootstrap();
		const onFocus = () => {
			if (status === 'pending-return' && !verifying && !alreadyMember) {
				verifyMembership();
			}
		};
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	});

	function openWorkspace() {
		if (workspaceUrl) {
			window.open(workspaceUrl, '_blank', 'noopener,noreferrer');
		}
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
			Puckstack is the task &amp; rewards platform we use to organise contributions.
		</p>
	</div>

	{#if alreadyMember}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:check-circle" class="mb-4 h-16 w-16 text-green-400" />
			<h3 class="text-lg font-bold text-white">You're a Member!</h3>
			<p class="text-solar-300 mt-2 text-center text-sm">
				You're part of the ecohubs workspace on Puckstack.
			</p>
			{#if puckstackUserId}
				<p class="mt-1 text-center text-xs text-emerald-300">
					Puckstack User ID linked automatically.
				</p>
			{/if}
			{#if errorMessage}
				<p class="mt-3 max-w-xs text-center text-xs text-amber-300">{errorMessage}</p>
			{/if}
			<button
				onclick={openWorkspace}
				class="mt-6 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
			>
				<Icon icon="tabler:external-link" class="h-4 w-4" />
				Open ecohubs Workspace
			</button>
			<button onclick={markCompleteAndClose} class="text-solar-300 mt-4 text-sm underline hover:text-white">
				Continue to next step
			</button>
		</div>
	{:else if status === 'pending-return' && joinUrl}
		<div class="flex flex-1 flex-col items-center justify-center">
			<Icon icon="tabler:external-link" class="mb-4 h-16 w-16 text-emerald-400" />
			<h3 class="text-lg font-bold text-white">Finish setup on Puckstack</h3>
			<p class="text-solar-300 mt-2 max-w-sm text-center text-sm">
				A new tab opened with your invitation. On Puckstack:
			</p>

			<ol class="text-solar-300 mt-3 max-w-sm space-y-1.5 text-left text-sm">
				<li class="flex items-start gap-2">
					<span class="text-solar-400 mt-0.5 shrink-0 font-mono text-xs">1.</span>
					<span>Sign in with your Google or GitHub account (or sign up if needed)</span>
				</li>
				<li class="flex items-start gap-2">
					<span class="text-solar-400 mt-0.5 shrink-0 font-mono text-xs">2.</span>
					<span>Click <strong>Accept invitation</strong> on the invitation page</span>
				</li>
				<li class="flex items-start gap-2">
					<span class="text-solar-400 mt-0.5 shrink-0 font-mono text-xs">3.</span>
					<span>Switch back to this tab — we'll link your account automatically</span>
				</li>
			</ol>

			{#if errorMessage}
				<div
					class="mt-4 flex max-w-sm items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
				>
					<Icon icon="tabler:alert-circle" class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{errorMessage}</span>
				</div>
			{/if}

			<button
				onclick={verifyMembership}
				disabled={verifying}
				class="mt-6 flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-medium text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if verifying}
					<Icon icon="tabler:loader" class="h-5 w-5 animate-spin" />
					Verifying…
				{:else}
					<Icon icon="tabler:refresh" class="h-5 w-5" />
					Verify my membership
				{/if}
			</button>

			<button
				onclick={() => window.open(joinUrl!, '_blank', 'noopener,noreferrer')}
				class="text-solar-400 mt-3 text-xs hover:text-white"
			>
				Reopen invitation link
			</button>
		</div>
	{:else}
		<div class="flex-1 space-y-4">
			<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
				<h4 class="text-solar-200 mb-2 flex items-center gap-2 text-sm font-medium">
					<Icon icon="tabler:info-circle" class="h-4 w-4 text-emerald-400" />
					What is Puckstack?
				</h4>
				<p class="text-solar-300 text-sm leading-relaxed">
					Puckstack is a separate platform that ecohubs uses to keep track of who's
					contributing and to recognise that work. Every time you take on a task — running an
					event, writing an article, helping with infrastructure — it gets recorded there and
					earns you XP and ECO tokens, which determine your member level over time.
				</p>
				<p class="text-solar-400 mt-3 text-xs leading-relaxed">
					You'll create a free Puckstack account in the next step (sign in with Google or
					GitHub — no separate password). It only takes a moment.
				</p>
			</div>

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

		<button
			onclick={verifyMembership}
			disabled={verifying}
			class="text-solar-400 mt-2 text-center text-xs hover:text-white disabled:opacity-50"
		>
			{#if verifying}
				Verifying…
			{:else}
				Already joined the workspace? Verify manually
			{/if}
		</button>
	{/if}
</div>
