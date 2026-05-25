<script lang="ts">
	import Icon from '@iconify/svelte';
	import { portal } from '$lib/actions/portal';
	import { os } from '$lib/os.svelte';

	const TITLE_MAX = 100;
	const MESSAGE_MAX = 2000;

	interface FeedbackItem {
		id: string;
		title: string;
		message: string;
		createdAt: string;
	}

	type View = 'form' | 'thanks' | 'list';

	let view = $state<View>('form');
	let title = $state('');
	let message = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	let items = $state<FeedbackItem[]>([]);
	let loadingList = $state(false);
	let hasLoaded = $state(false);

	const hasItems = $derived(items.length > 0);

	// Load the member's own feedback the first time the window opens.
	$effect(() => {
		if (os.feedbackOpen && !hasLoaded) {
			loadList();
		}
	});

	async function loadList() {
		loadingList = true;
		try {
			const res = await fetch('/api/feedback');
			if (res.ok) {
				const data = await res.json();
				items = Array.isArray(data.feedback) ? data.feedback : [];
			}
		} catch {
			// Non-fatal — list simply stays empty
		} finally {
			loadingList = false;
			hasLoaded = true;
		}
	}

	async function submit() {
		if (submitting) return;
		error = null;
		if (title.trim().length === 0) {
			error = 'Please add a short title';
			return;
		}
		if (message.trim().length === 0) {
			error = 'Please write your feedback';
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: title.trim(), message: message.trim() })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || `Failed (${res.status})`);
			}
			const data = await res.json();
			if (data.feedback) items = [data.feedback, ...items];
			title = '';
			message = '';
			view = 'thanks';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to send feedback';
		} finally {
			submitting = false;
		}
	}

	function open() {
		os.openFeedback();
		view = 'form';
	}

	function close() {
		os.closeFeedback();
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString([], {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<!-- Desktop floating trigger (mobile uses the + FAB menu instead) -->
<button type="button" class="fab" class:open={os.feedbackOpen} onclick={open} aria-label="Send feedback">
	<Icon icon="tabler:message-2" class="h-6 w-6" />
</button>

{#if os.feedbackOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="panel" use:portal onkeydown={handleKey} role="dialog" aria-modal="false" tabindex="-1">
		<div class="panel-header">
			<h2>Feedback</h2>
			<div class="header-actions">
				{#if hasItems}
					{#if view === 'list'}
						<button type="button" class="text-btn" onclick={() => (view = 'form')}>
							<Icon icon="tabler:plus" class="h-4 w-4" /> New
						</button>
					{:else}
						<button type="button" class="text-btn" onclick={() => (view = 'list')}>
							<Icon icon="tabler:list" class="h-4 w-4" /> My feedback
						</button>
					{/if}
				{/if}
				<button type="button" class="close-btn" onclick={close} aria-label="Close">
					<Icon icon="tabler:x" class="h-4 w-4" />
				</button>
			</div>
		</div>

		<div class="panel-body">
			{#if view === 'form'}
				<p class="lead">Send us your feedback</p>
				<p class="hint">
					We want to know how to improve ecohubsOS — or hear about any technical issues you run into.
				</p>

				<label class="field-label" for="feedback-title">Title</label>
				<input
					id="feedback-title"
					class="text-input"
					bind:value={title}
					maxlength={TITLE_MAX}
					placeholder="A short summary"
				/>

				<label class="field-label" for="feedback-message">Feedback</label>
				<textarea
					id="feedback-message"
					class="text-input"
					bind:value={message}
					maxlength={MESSAGE_MAX}
					rows="5"
					placeholder="Tell us what's on your mind…"
				></textarea>
				<div class="counter">{message.length} / {MESSAGE_MAX}</div>

				{#if error}
					<div class="error">{error}</div>
				{/if}

				<button type="button" class="btn btn-primary full" onclick={submit} disabled={submitting}>
					{#if submitting}
						Sending…
					{:else}
						<Icon icon="tabler:send" class="h-4 w-4" /> Send feedback
					{/if}
				</button>
			{:else if view === 'thanks'}
				<div class="thanks">
					<div class="thanks-icon">
						<Icon icon="tabler:heart-handshake" class="h-10 w-10" />
					</div>
					<h3>Thank you!</h3>
					<p>
						We really appreciate you taking the time. Your feedback helps us make ecohubsOS better
						for everyone.
					</p>
					<button type="button" class="btn btn-ghost full" onclick={() => (view = 'list')}>
						<Icon icon="tabler:list" class="h-4 w-4" /> View my feedback
					</button>
				</div>
			{:else if view === 'list'}
				{#if loadingList}
					<div class="list-empty">Loading…</div>
				{:else if items.length === 0}
					<div class="list-empty">You haven't sent any feedback yet.</div>
				{:else}
					<ul class="list">
						{#each items as item (item.id)}
							<li class="list-item">
								<div class="list-item-head">
									<span class="list-item-title">{item.title}</span>
									<span class="list-item-date">{formatDate(item.createdAt)}</span>
								</div>
								<p class="list-item-msg">{item.message}</p>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.fab {
		position: fixed;
		right: 1.5rem;
		bottom: 1.5rem;
		z-index: 40;
		display: none;
		height: 3.25rem;
		width: 3.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgb(99, 102, 241);
		color: white;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
		cursor: pointer;
		transition:
			transform 0.2s ease,
			background 0.2s ease;
	}
	/* Desktop only — mobile opens the same window from the + FAB menu */
	@media (min-width: 768px) {
		.fab {
			display: flex;
		}
	}
	.fab:hover {
		background: rgb(79, 82, 221);
		transform: translateY(-2px);
	}
	.fab.open {
		background: rgb(79, 82, 221);
	}

	.panel {
		position: fixed;
		z-index: 9999;
		background: #1a1a1f;
		border: 1px solid rgba(255, 255, 255, 0.12);
		display: flex;
		flex-direction: column;
		color: white;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
	}
	/* Mobile: bottom sheet */
	@media (max-width: 767px) {
		.panel {
			left: 0;
			right: 0;
			bottom: 0;
			max-height: 85vh;
			border-radius: 16px 16px 0 0;
		}
	}
	/* Desktop: anchored card above the trigger button */
	@media (min-width: 768px) {
		.panel {
			right: 1.5rem;
			bottom: 5.25rem;
			width: 380px;
			max-height: 70vh;
			border-radius: 14px;
		}
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}
	.panel-header h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.text-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: rgba(255, 255, 255, 0.06);
		border: none;
		color: rgba(255, 255, 255, 0.85);
		cursor: pointer;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		font-size: 0.8rem;
	}
	.text-btn:hover {
		background: rgba(255, 255, 255, 0.12);
		color: white;
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

	.panel-body {
		padding: 1.1rem;
		overflow-y: auto;
	}
	.lead {
		margin: 0 0 0.3rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.hint {
		margin: 0 0 1rem;
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.82rem;
		line-height: 1.4;
	}
	.field-label {
		display: block;
		font-size: 0.8rem;
		font-weight: 500;
		margin-bottom: 0.35rem;
	}
	.text-input {
		width: 100%;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		color: white;
		font-family: inherit;
		font-size: 0.9rem;
		margin-bottom: 0.8rem;
		resize: vertical;
	}
	.text-input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.6);
	}
	.counter {
		text-align: right;
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.4);
		margin-top: -0.6rem;
		margin-bottom: 0.6rem;
	}
	.error {
		margin-bottom: 0.8rem;
		padding: 0.55rem 0.75rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.82rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		border: none;
		border-radius: 8px;
		padding: 0.6rem 1.1rem;
		font-weight: 500;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn.full {
		width: 100%;
	}
	.btn-primary {
		background: rgb(99, 102, 241);
		color: white;
	}
	.btn-primary:hover:not(:disabled) {
		background: rgb(79, 82, 221);
	}
	.btn-ghost {
		background: rgba(255, 255, 255, 0.06);
		color: white;
	}
	.btn-ghost:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
	}

	.thanks {
		text-align: center;
		padding: 1rem 0.5rem 0.5rem;
	}
	.thanks-icon {
		display: flex;
		justify-content: center;
		color: rgb(129, 140, 248);
		margin-bottom: 0.6rem;
	}
	.thanks h3 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
		font-weight: 600;
	}
	.thanks p {
		margin: 0 0 1.2rem;
		color: rgba(255, 255, 255, 0.65);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.list-item {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		padding: 0.7rem 0.85rem;
	}
	.list-item-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.3rem;
	}
	.list-item-title {
		font-weight: 600;
		font-size: 0.9rem;
	}
	.list-item-date {
		font-size: 0.72rem;
		color: rgba(255, 255, 255, 0.4);
		white-space: nowrap;
	}
	.list-item-msg {
		margin: 0;
		font-size: 0.84rem;
		color: rgba(255, 255, 255, 0.7);
		line-height: 1.45;
		white-space: pre-wrap;
	}
	.list-empty {
		text-align: center;
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.88rem;
		padding: 1.5rem 0;
	}
</style>
