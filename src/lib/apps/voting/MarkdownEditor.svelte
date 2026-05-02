<script lang="ts">
	import MarkdownView from './MarkdownView.svelte';

	interface Props {
		value: string;
		maxLength?: number;
		placeholder?: string;
		rows?: number;
	}

	let {
		value = $bindable(''),
		maxLength = 10000,
		placeholder = 'Write your proposal in Markdown…',
		rows = 14
	}: Props = $props();

	let showPreview = $state(false);
</script>

<div class="md-editor">
	<div class="md-editor-toolbar">
		<button
			type="button"
			class="md-tab"
			class:active={!showPreview}
			onclick={() => (showPreview = false)}
		>
			Write
		</button>
		<button
			type="button"
			class="md-tab"
			class:active={showPreview}
			onclick={() => (showPreview = true)}
		>
			Preview
		</button>
		<span class="md-counter" class:over={value.length > maxLength}>
			{value.length} / {maxLength}
		</span>
	</div>

	{#if showPreview}
		<div class="md-pane md-preview">
			{#if value.trim()}
				<MarkdownView source={value} />
			{:else}
				<p class="md-empty">Nothing to preview yet.</p>
			{/if}
		</div>
	{:else}
		<textarea
			class="md-pane md-textarea"
			bind:value
			{placeholder}
			{rows}
			maxlength={maxLength}
		></textarea>
	{/if}
</div>

<style>
	.md-editor {
		display: flex;
		flex-direction: column;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.md-editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.2);
	}
	.md-tab {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.6);
		padding: 0.3rem 0.7rem;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.md-tab:hover {
		color: rgba(255, 255, 255, 0.85);
		background: rgba(255, 255, 255, 0.05);
	}
	.md-tab.active {
		color: #e0e7ff;
		background: rgba(99, 102, 241, 0.18);
	}
	.md-counter {
		margin-left: auto;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.45);
	}
	.md-counter.over {
		color: #fca5a5;
	}
	.md-pane {
		padding: 0.9rem 1rem;
		min-height: 16rem;
		font-size: 0.95rem;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.92);
	}
	.md-textarea {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		resize: vertical;
		font-family: inherit;
	}
	.md-preview {
		overflow-y: auto;
		max-height: 30rem;
	}
	.md-empty {
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
	}
</style>
