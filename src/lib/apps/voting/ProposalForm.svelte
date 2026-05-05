<script lang="ts">
	import Icon from '@iconify/svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import type { TagOption } from './types';
	import { os } from '$lib/os.svelte';

	interface Props {
		availableTags: TagOption[];
		onCancel: () => void;
		onCreated: (id: string) => void;
	}

	let { availableTags, onCancel, onCreated }: Props = $props();

	const TITLE_MAX = 140;
	const BODY_MAX = 10000;
	const TAG_MAX = 5;

	let type = $state<'operational' | 'strategic' | 'constitutional'>('operational');
	let title = $state('');
	let body = $state('');
	let tagInput = $state('');
	let tags = $state<string[]>([]);
	let submitting = $state(false);
	let submittedSuccessfully = $state(false);
	let error = $state<string | null>(null);

	const titleOver = $derived(title.length > TITLE_MAX);
	const bodyOver = $derived(body.length > BODY_MAX);

	// Form has unsaved changes whenever the user has typed anything OR
	// added a tag. Once submission succeeds, dirty resets to false so
	// the unmount cleanup doesn't trip the discard prompt.
	const dirty = $derived(
		!submittedSuccessfully &&
			(title.trim().length > 0 ||
				body.trim().length > 0 ||
				tags.length > 0 ||
				tagInput.trim().length > 0)
	);

	const DISCARD_PROMPT = 'You have an unsaved proposal draft. Discard it?';

	function confirmDiscard(): boolean {
		if (!dirty) return true;
		return window.confirm(DISCARD_PROMPT);
	}

	function handleCancel() {
		if (confirmDiscard()) onCancel();
	}

	// Guard the OS-level close (X button + backdrop click). Returns
	// false to block the close when the user declines the prompt.
	$effect(() => {
		os.setCloseGuard(() => confirmDiscard());
		return () => os.setCloseGuard(null);
	});

	// Browser-level navigation / tab close. The browser displays a
	// generic "Leave site?" prompt — text isn't customisable in
	// modern browsers. Only attached while dirty so non-edited
	// sessions don't get the prompt.
	$effect(() => {
		if (!dirty) return;
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			// Required by some legacy browsers to actually surface the prompt.
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	function normaliseTag(raw: string): string | null {
		const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-');
		if (!trimmed) return null;
		if (trimmed.length > 30) return null;
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) return null;
		return trimmed;
	}

	function addTag(raw: string) {
		const norm = normaliseTag(raw);
		if (!norm) return;
		if (tags.includes(norm)) return;
		if (tags.length >= TAG_MAX) return;
		tags = [...tags, norm];
		tagInput = '';
	}

	function removeTag(t: string) {
		tags = tags.filter((x) => x !== t);
	}

	function onTagKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTag(tagInput);
		} else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
			tags = tags.slice(0, -1);
		}
	}

	const tagSuggestions = $derived(
		availableTags
			.map((t) => t.tag)
			.filter((t) => !tags.includes(t))
			.filter((t) => (tagInput ? t.includes(tagInput.toLowerCase()) : true))
			.slice(0, 8)
	);

	async function submit() {
		error = null;
		if (title.trim().length === 0) {
			error = 'Title is required';
			return;
		}
		if (titleOver) {
			error = `Title must be ≤ ${TITLE_MAX} characters`;
			return;
		}
		if (body.trim().length === 0) {
			error = 'Body is required';
			return;
		}
		if (bodyOver) {
			error = `Body must be ≤ ${BODY_MAX} characters`;
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/proposals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, title: title.trim(), body, tags })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || `Failed (${res.status})`);
			}
			const data = await res.json();
			submittedSuccessfully = true;
			onCreated(data.proposal.id);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create proposal';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="form-root">
	<button class="back-btn" onclick={handleCancel}>
		<Icon icon="tabler:chevron-left" class="h-4 w-4" />
		Cancel
	</button>

	<h1>New Proposal</h1>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	<div class="field">
		<label for="proposal-type">Type</label>
		<select id="proposal-type" class="input" bind:value={type}>
			<option value="operational">Operational — 3 day vote</option>
			<option value="strategic">Strategic — 5 day deliberation, 7 day vote</option>
			<option value="constitutional">
				Constitutional — 15 day deliberation, 14 day vote, 30 day ratification
			</option>
		</select>
	</div>

	<div class="field">
		<label for="proposal-title">
			Title
			<span class="counter" class:over={titleOver}>{title.length} / {TITLE_MAX}</span>
		</label>
		<input
			id="proposal-title"
			class="input"
			class:invalid={titleOver}
			type="text"
			bind:value={title}
			maxlength={TITLE_MAX + 20}
			placeholder="A short, clear title"
		/>
	</div>

	<div class="field">
		<label for="proposal-body">Description (Markdown)</label>
		<MarkdownEditor bind:value={body} maxLength={BODY_MAX} />
	</div>

	<div class="field">
		<label for="proposal-tags">
			Tags <span class="hint-inline">({tags.length} / {TAG_MAX}, optional)</span>
		</label>
		<div class="tag-row">
			{#each tags as t (t)}
				<span class="tag-chip">
					#{t}
					<button type="button" class="tag-rm" onclick={() => removeTag(t)} aria-label="Remove tag">
						<Icon icon="tabler:x" class="h-3 w-3" />
					</button>
				</span>
			{/each}
			{#if tags.length < TAG_MAX}
				<input
					id="proposal-tags"
					class="tag-input"
					bind:value={tagInput}
					onkeydown={onTagKeyDown}
					placeholder="Type and press Enter"
				/>
			{/if}
		</div>
		{#if tagSuggestions.length > 0 && tags.length < TAG_MAX}
			<div class="tag-suggestions">
				{#each tagSuggestions as s (s)}
					<button type="button" class="tag-suggestion" onclick={() => addTag(s)}>#{s}</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="actions">
		<button type="button" class="btn-ghost" onclick={handleCancel} disabled={submitting}>Cancel</button>
		<button
			type="button"
			class="btn-primary"
			onclick={submit}
			disabled={submitting || titleOver || bodyOver}
		>
			{submitting ? 'Submitting…' : 'Submit Proposal'}
		</button>
	</div>
</div>

<style>
	.form-root {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.2rem 2rem;
	}
	.back-btn {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.back-btn:hover {
		color: white;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field label {
		font-size: 0.85rem;
		font-weight: 500;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.counter {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.45);
		font-weight: 400;
	}
	.counter.over {
		color: #fca5a5;
	}
	.hint-inline {
		font-weight: 400;
		color: rgba(255, 255, 255, 0.45);
		font-size: 0.78rem;
	}
	.input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		color: white;
		font-family: inherit;
		font-size: 0.9rem;
	}
	.input:focus {
		outline: none;
		border-color: rgba(99, 102, 241, 0.6);
	}
	.input.invalid {
		border-color: rgba(239, 68, 68, 0.5);
	}
	.tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.4rem;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		min-height: 2.6rem;
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		background: rgba(99, 102, 241, 0.18);
		color: #c7d2fe;
		border-radius: 999px;
		font-size: 0.8rem;
	}
	.tag-rm {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0;
		display: inline-flex;
	}
	.tag-input {
		flex: 1;
		min-width: 8rem;
		background: transparent;
		border: none;
		color: white;
		outline: none;
		font-size: 0.85rem;
	}
	.tag-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tag-suggestion {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.7);
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.tag-suggestion:hover {
		background: rgba(99, 102, 241, 0.18);
		color: #c7d2fe;
	}
	.error-banner {
		padding: 0.6rem 0.9rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}
	.btn-ghost {
		background: rgba(255, 255, 255, 0.06);
		color: white;
		border: none;
		padding: 0.55rem 1rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.btn-ghost:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
	}
	.btn-primary {
		background: rgb(99, 102, 241);
		color: white;
		border: none;
		padding: 0.55rem 1.2rem;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.9rem;
		font-weight: 500;
	}
	.btn-primary:hover:not(:disabled) {
		background: rgb(79, 82, 221);
	}
	.btn-primary:disabled,
	.btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
