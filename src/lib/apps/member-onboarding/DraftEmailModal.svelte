<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import { type DraftEmail, emailKindMeta } from './types';

	let { draft, onClose, onDone }: { draft: DraftEmail; onClose: () => void; onDone: () => void } =
		$props();

	// Seeded on mount rather than inline, matching EmailComposerModal. The parent
	// keys this component on the draft id, so selecting a different draft
	// remounts it — no $effect needed to resync, and a steward's half-finished
	// edit is never silently replaced underneath them.
	let subject = $state('');
	let body = $state('');
	let dismissReason = $state('');
	let confirmingDismiss = $state(false);
	let busy = $state<null | 'send' | 'dismiss'>(null);
	let error = $state<string | null>(null);

	const meta = $derived(emailKindMeta(draft.kind));
	const edited = $derived(subject !== draft.subject || body !== draft.body);

	onMount(() => {
		subject = draft.subject;
		body = draft.body;
	});

	async function act(action: 'send' | 'dismiss') {
		error = null;
		busy = action;
		try {
			const res = await fetch(`/api/member-emails/${draft.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					action === 'send'
						? { action, subject, body }
						: { action, reason: dismissReason || undefined }
				)
			});
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload.message ?? `Could not ${action} this email`);
			}
			onDone();
			onClose();
		} catch (err) {
			error = err instanceof Error ? err.message : `Could not ${action} this email`;
		} finally {
			busy = null;
		}
	}
</script>

<div
	use:portal
	class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-label="Review member email"
	tabindex="-1"
	onclick={(e) => e.target === e.currentTarget && onClose()}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#111c1c] shadow-2xl"
	>
		<!-- Header -->
		<div class="flex items-start justify-between gap-3 border-b border-white/10 p-4">
			<div class="min-w-0">
				<div class="mb-1 flex items-center gap-2">
					<span
						class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium {meta.toneClass}"
					>
						<Icon icon={meta.icon} class="h-3 w-3" />
						{meta.label}
					</span>
				</div>
				<h2 class="truncate text-base font-semibold text-white">To {draft.displayName}</h2>
				<p class="truncate text-xs text-white/40">{draft.email}</p>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white"
				aria-label="Close"
			>
				<Icon icon="tabler:x" class="h-4 w-4" />
			</button>
		</div>

		<div class="flex-1 space-y-3 overflow-y-auto p-4">
			{#if meta.hint}
				<p class="rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs text-white/60">
					{meta.hint}
				</p>
			{/if}

			<label class="block">
				<span class="mb-1 block text-xs font-medium text-white/60">Subject</span>
				<input
					bind:value={subject}
					class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
				/>
			</label>

			<label class="block">
				<span class="mb-1 block text-xs font-medium text-white/60">
					Message
					<span class="font-normal text-white/30">— edit freely; this is what they receive</span>
				</span>
				<textarea
					bind:value={body}
					rows="14"
					class="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[13px] leading-relaxed text-white focus:border-white/30 focus:outline-none"
				></textarea>
			</label>

			{#if error}
				<p class="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">
					{error}
				</p>
			{/if}

			{#if confirmingDismiss}
				<div class="rounded-lg border border-white/10 bg-white/5 p-3">
					<p class="mb-2 text-xs text-white/60">
						Not sending this one? A short note on why helps whoever looks later.
					</p>
					<input
						bind:value={dismissReason}
						placeholder="e.g. spoke to them in person"
						class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
					/>
				</div>
			{/if}
		</div>

		<!-- Actions -->
		<div class="flex items-center justify-between gap-3 border-t border-white/10 p-4">
			<button
				type="button"
				onclick={() => (confirmingDismiss ? act('dismiss') : (confirmingDismiss = true))}
				disabled={!!busy}
				class="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
			>
				{#if busy === 'dismiss'}
					<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
				{:else}
					{confirmingDismiss ? 'Confirm — don’t send' : 'Don’t send'}
				{/if}
			</button>

			<div class="flex items-center gap-2">
				{#if edited}
					<span class="text-[11px] text-white/40">Edited</span>
				{/if}
				<button
					type="button"
					onclick={() => act('send')}
					disabled={!!busy || !subject.trim() || !body.trim()}
					class="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-40"
				>
					{#if busy === 'send'}
						<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
					{:else}
						<Icon icon="tabler:send" class="h-4 w-4" />
					{/if}
					Send to {draft.displayName}
				</button>
			</div>
		</div>
	</div>
</div>
