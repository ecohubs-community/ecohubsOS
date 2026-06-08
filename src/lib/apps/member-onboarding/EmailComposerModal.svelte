<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { portal } from '$lib/actions/portal';

	// Rendered only while active (parent guards with {#if}), so initialization
	// happens on mount rather than via an $effect watching an `open` prop.
	let {
		kind,
		onboardingId,
		recipientEmail,
		initialSubject = '',
		initialBody = '',
		onClose,
		onDone
	}: {
		kind: 'reminder' | 'buddyCall';
		onboardingId: string;
		recipientEmail: string;
		initialSubject?: string;
		initialBody?: string;
		onClose: () => void;
		onDone: () => void;
	} = $props();

	let subject = $state('');
	let body = $state('');
	let loading = $state(false);
	let busy = $state<null | 'send' | 'mark' | 'copy'>(null);
	let error = $state<string | null>(null);
	let copied = $state(false);

	const endpoint = $derived(
		kind === 'reminder'
			? `/api/onboarding-board/${onboardingId}/reminder`
			: `/api/onboarding-board/${onboardingId}/buddy-call/invite`
	);
	const title = $derived(kind === 'reminder' ? 'Login reminder email' : 'Buddy-call invitation');

	onMount(() => {
		if (kind === 'reminder') {
			loadReminderTemplate();
		} else {
			subject = initialSubject;
			body = initialBody;
		}
	});

	async function loadReminderTemplate() {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/enrollment-link`);
			if (!res.ok) throw new Error('Failed to generate enrollment link');
			const data = await res.json();
			subject = data.template.subject;
			body = data.template.body;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load template';
		} finally {
			loading = false;
		}
	}

	async function copyToClipboard() {
		busy = 'copy';
		try {
			await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			error = 'Could not copy to clipboard';
		} finally {
			busy = null;
		}
	}

	async function submit(mode: 'send' | 'mark') {
		if (busy) return;
		if (mode === 'send' && (!subject.trim() || !body.trim())) {
			error = 'Subject and body are required to send';
			return;
		}
		busy = mode;
		error = null;
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode, subject, body })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || 'Request failed');
			}
			onDone();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Request failed';
		} finally {
			busy = null;
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<div
	class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
	use:portal
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={handleBackdrop}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#16161c] shadow-2xl"
	>
		<div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
			<div>
				<h2 class="text-base font-semibold text-white">{title}</h2>
				<p class="text-xs text-white/40">To: {recipientEmail}</p>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
				aria-label="Close"
			>
				<Icon icon="tabler:x" class="h-5 w-5" />
			</button>
		</div>

		<div class="flex-1 space-y-3 overflow-y-auto px-5 py-4">
			{#if loading}
				<div class="flex h-40 items-center justify-center">
					<Icon icon="tabler:loader-2" class="h-7 w-7 animate-spin text-white/40" />
				</div>
			{:else}
				{#if kind === 'reminder'}
					<div class="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
						<span class="text-xs text-white/50">
							A fresh single-use enrollment link is embedded in the body.
						</span>
						<button
							type="button"
							onclick={loadReminderTemplate}
							disabled={busy !== null}
							class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-teal-300 hover:bg-white/10"
						>
							<Icon icon="tabler:refresh" class="h-3.5 w-3.5" />
							Regenerate link
						</button>
					</div>
				{/if}

				<div>
					<label for="composer-subject" class="mb-1 block text-xs font-medium text-white/60">
						Subject
					</label>
					<input
						id="composer-subject"
						type="text"
						bind:value={subject}
						class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none"
					/>
				</div>

				<div>
					<label for="composer-body" class="mb-1 block text-xs font-medium text-white/60">
						Message — edit freely before sending
					</label>
					<textarea
						id="composer-body"
						bind:value={body}
						rows={16}
						class="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[13px] leading-relaxed text-white focus:border-teal-400 focus:outline-none"
					></textarea>
				</div>

				{#if error}
					<div class="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
						{error}
					</div>
				{/if}
			{/if}
		</div>

		<div class="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
			<button
				type="button"
				onclick={copyToClipboard}
				disabled={busy !== null || loading}
				class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
			>
				<Icon icon={copied ? 'tabler:check' : 'tabler:copy'} class="h-4 w-4" />
				{copied ? 'Copied' : 'Copy'}
			</button>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => submit('mark')}
					disabled={busy !== null || loading}
					class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
					title="Record as sent (if you sent it yourself)"
				>
					{#if busy === 'mark'}
						<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
					{:else}
						<Icon icon="tabler:check" class="h-4 w-4" />
					{/if}
					Mark as sent
				</button>
				<button
					type="button"
					onclick={() => submit('send')}
					disabled={busy !== null || loading}
					class="flex items-center gap-1.5 rounded-lg bg-linear-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-medium text-white hover:from-teal-400 hover:to-emerald-400 disabled:opacity-40"
				>
					{#if busy === 'send'}
						<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
					{:else}
						<Icon icon="tabler:send" class="h-4 w-4" />
					{/if}
					Send now
				</button>
			</div>
		</div>
	</div>
</div>
