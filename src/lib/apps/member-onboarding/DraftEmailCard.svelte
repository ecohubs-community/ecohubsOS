<script lang="ts">
	import Icon from '@iconify/svelte';
	import { type DraftEmail, emailKindMeta, fmtRelative } from './types';

	let { draft, onclick }: { draft: DraftEmail; onclick: () => void } = $props();

	const meta = $derived(emailKindMeta(draft.kind));
</script>

<button
	type="button"
	{onclick}
	class="group w-full rounded-xl border p-3 text-left transition-all hover:brightness-125 {meta.toneClass}"
>
	<div class="flex items-start gap-2.5">
		<Icon icon={meta.icon} class="mt-0.5 h-4 w-4 shrink-0" />
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline justify-between gap-2">
				<span class="text-xs font-semibold">{meta.label}</span>
				{#if draft.createdAt}
					<span class="shrink-0 text-[10px] opacity-60">{fmtRelative(draft.createdAt)}</span>
				{/if}
			</div>
			<p class="truncate text-sm font-medium text-white">{draft.displayName}</p>
			<p class="truncate text-xs opacity-70">{draft.subject}</p>
		</div>
	</div>
</button>
