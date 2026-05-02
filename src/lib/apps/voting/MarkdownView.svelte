<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	interface Props {
		source: string;
		class?: string;
	}

	let { source, class: className = '' }: Props = $props();

	marked.setOptions({ gfm: true, breaks: true });

	let html = $derived.by(() => {
		const raw = marked.parse(source ?? '', { async: false }) as string;
		return DOMPurify.sanitize(raw, {
			ALLOWED_TAGS: [
				'p',
				'br',
				'strong',
				'em',
				'u',
				'code',
				'pre',
				'blockquote',
				'ul',
				'ol',
				'li',
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				'a',
				'hr',
				'table',
				'thead',
				'tbody',
				'tr',
				'th',
				'td',
				'del',
				'span'
			],
			ALLOWED_ATTR: ['href', 'title', 'rel', 'target'],
			ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/|#)/i,
			ADD_ATTR: ['target']
		});
	});
</script>

<div class={`markdown-view ${className}`}>{@html html}</div>

<style>
	.markdown-view :global(h1),
	.markdown-view :global(h2),
	.markdown-view :global(h3),
	.markdown-view :global(h4) {
		font-weight: 600;
		margin: 1em 0 0.4em;
		line-height: 1.25;
	}
	.markdown-view :global(h1) {
		font-size: 1.6em;
	}
	.markdown-view :global(h2) {
		font-size: 1.35em;
	}
	.markdown-view :global(h3) {
		font-size: 1.15em;
	}
	.markdown-view :global(p) {
		margin: 0.7em 0;
		line-height: 1.55;
	}
	.markdown-view :global(ul),
	.markdown-view :global(ol) {
		padding-left: 1.4em;
		margin: 0.6em 0;
	}
	.markdown-view :global(li) {
		margin: 0.2em 0;
	}
	.markdown-view :global(a) {
		color: #a5b4fc;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.markdown-view :global(code) {
		background: rgba(255, 255, 255, 0.08);
		padding: 0.1em 0.35em;
		border-radius: 4px;
		font-size: 0.9em;
	}
	.markdown-view :global(pre) {
		background: rgba(0, 0, 0, 0.4);
		padding: 0.8em 1em;
		border-radius: 8px;
		overflow-x: auto;
	}
	.markdown-view :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.markdown-view :global(blockquote) {
		border-left: 3px solid rgba(255, 255, 255, 0.2);
		padding-left: 1em;
		margin: 0.8em 0;
		color: rgba(255, 255, 255, 0.75);
	}
	.markdown-view :global(table) {
		border-collapse: collapse;
		margin: 0.8em 0;
	}
	.markdown-view :global(th),
	.markdown-view :global(td) {
		border: 1px solid rgba(255, 255, 255, 0.15);
		padding: 0.4em 0.7em;
	}
</style>
