<script lang="ts">
	import Icon from '@iconify/svelte';
	import { portal } from '$lib/actions/portal';

	interface Props {
		choice: string;
		open: boolean;
		onCancel: () => void;
		onConfirm: (reason: string) => Promise<void> | void;
	}

	let { choice, open, onCancel, onConfirm }: Props = $props();

	const REASON_MAX = 1000;

	let reason = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (open) {
			reason = '';
			error = null;
			submitting = false;
		}
	});

	async function confirm() {
		if (submitting) return;
		submitting = true;
		error = null;
		try {
			await onConfirm(reason.trim());
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to submit vote';
			submitting = false;
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onCancel();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		use:portal
		onclick={handleBackdrop}
		onkeydown={handleKey}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="modal">
			<div class="modal-header">
				<h2>Confirm your vote</h2>
				<button type="button" class="close-btn" onclick={onCancel} aria-label="Close">
					<Icon icon="tabler:x" class="h-4 w-4" />
				</button>
			</div>

			<div class="modal-body">
				<p class="lead">
					You are about to vote
					<strong class="choice">{choice}</strong>.
				</p>
				<p class="hint">Once submitted, your vote cannot be changed.</p>

				<label class="reason-label" for="vote-reason">
					Reason <span class="optional">(optional)</span>
				</label>
				<textarea
					id="vote-reason"
					class="reason-input"
					bind:value={reason}
					maxlength={REASON_MAX}
					rows="4"
					placeholder="Explain your vote so others understand…"
				></textarea>
				<div class="counter">{reason.length} / {REASON_MAX}</div>

				{#if error}
					<div class="error">{error}</div>
				{/if}
			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" onclick={onCancel} disabled={submitting}>
					Cancel
				</button>
				<button type="button" class="btn btn-primary" onclick={confirm} disabled={submitting}>
					{submitting ? 'Submitting…' : `Vote ${choice}`}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}
	.modal {
		background: #1a1a1f;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 14px;
		width: min(560px, 92vw);
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		overflow: hidden;
	}
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.modal-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.close-btn {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.5);
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 6px;
	}
	.close-btn:hover {
		color: white;
		background: rgba(255, 255, 255, 0.08);
	}
	.modal-body {
		padding: 1.2rem;
		overflow-y: auto;
	}
	.lead {
		margin: 0 0 0.4rem;
		font-size: 0.95rem;
	}
	.choice {
		color: #c7d2fe;
	}
	.hint {
		margin: 0 0 1.1rem;
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.85rem;
	}
	.reason-label {
		display: block;
		font-size: 0.85rem;
		font-weight: 500;
		margin-bottom: 0.4rem;
	}
	.optional {
		color: rgba(255, 255, 255, 0.45);
		font-weight: 400;
	}
	.reason-input {
		width: 100%;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		color: white;
		font-family: inherit;
		font-size: 0.9rem;
		resize: vertical;
	}
	.reason-input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.6);
	}
	.counter {
		text-align: right;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin-top: 0.3rem;
	}
	.error {
		margin-top: 0.8rem;
		padding: 0.6rem 0.8rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.9rem 1.2rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}
	.btn {
		border: none;
		border-radius: 8px;
		padding: 0.55rem 1.1rem;
		font-weight: 500;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-ghost {
		background: rgba(255, 255, 255, 0.06);
		color: white;
	}
	.btn-ghost:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
	}
	.btn-primary {
		background: rgb(99, 102, 241);
		color: white;
	}
	.btn-primary:hover:not(:disabled) {
		background: rgb(79, 82, 221);
	}
</style>
