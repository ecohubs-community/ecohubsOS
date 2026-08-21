<script lang="ts">
	import Icon from '@iconify/svelte';
	import { fly, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toast, type ToastVariant } from '$lib/toast.svelte';

	/** Icon and colour per variant. One place, so toasts stay recognisable. */
	const STYLES: Record<ToastVariant, { icon: string; ring: string; tint: string; fg: string }> = {
		info: {
			icon: 'tabler:info-circle',
			ring: 'ring-white/15',
			tint: 'bg-white/10',
			fg: 'text-white/70'
		},
		success: {
			icon: 'tabler:circle-check',
			ring: 'ring-emerald-400/25',
			tint: 'bg-emerald-400/15',
			fg: 'text-emerald-300'
		},
		reward: {
			icon: 'tabler:sparkles',
			ring: 'ring-amber-300/30',
			tint: 'bg-amber-300/15',
			fg: 'text-amber-300'
		},
		error: {
			icon: 'tabler:alert-triangle',
			ring: 'ring-red-400/25',
			tint: 'bg-red-400/15',
			fg: 'text-red-300'
		}
	};
</script>

<!--
	Toast stack. Fixed above everything, but `pointer-events-none` on the column
	so it never swallows a click meant for the desktop underneath — only the
	toasts themselves take input.

	`aria-live="polite"` rather than assertive: a toast reports something that
	already happened, so it should wait its turn rather than cut across whatever
	the member is reading.
-->
<div
	class="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
	role="status"
	aria-live="polite"
>
	{#each toast.toasts as t (t.id)}
		{@const style = STYLES[t.variant]}
		<div
			animate:flip={{ duration: 250 }}
			in:fly={{ x: 24, duration: 220 }}
			out:scale={{ start: 0.94, duration: 160 }}
			class="pointer-events-auto flex items-start gap-3 rounded-2xl bg-solar-900/90 p-3 shadow-2xl ring-1 backdrop-blur-md {style.ring}"
		>
			<span
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl {style.tint} {style.fg}"
			>
				<Icon icon={t.icon ?? style.icon} class="h-5 w-5" />
			</span>

			<div class="min-w-0 flex-1 pt-0.5">
				<p class="text-sm font-medium text-white">{t.title}</p>
				{#if t.message}
					<p class="mt-0.5 text-xs text-white/50">{t.message}</p>
				{/if}
			</div>

			<button
				type="button"
				onclick={() => toast.dismiss(t.id)}
				aria-label="Dismiss notification"
				class="-m-1 shrink-0 rounded-lg p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
			>
				<Icon icon="tabler:x" class="h-4 w-4" />
			</button>
		</div>
	{/each}
</div>
