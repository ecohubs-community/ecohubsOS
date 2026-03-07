<script lang="ts">
	import type { Component } from 'svelte';
	import Icon from '@iconify/svelte';
	import { fade, scale } from 'svelte/transition';

	let {
		component,
		title,
		onClose
	}: {
		component: Component;
		title: string;
		onClose: () => void;
	} = $props();
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
	transition:fade={{ duration: 200 }}
>
	<!-- Frame -->
	<div
		class="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-solar-900/95 shadow-2xl backdrop-blur-xl"
		transition:scale={{ start: 0.95, duration: 200 }}
	>
		<!-- Title bar -->
		<div
			class="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-white/5 px-4"
		>
			<span class="text-sm font-medium text-white">{title}</span>
			<button
				type="button"
				onclick={onClose}
				class="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
			>
				<Icon icon="tabler:x" class="h-4 w-4" />
			</button>
		</div>
		<!-- App content -->
		<div class="flex-1 overflow-y-auto">
			{#if component}
				{@const App = component}
				<App />
			{/if}
		</div>
	</div>
</div>
