<script lang="ts">
	import { slide } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	let {
		appId,
		title = 'About this app',
		defaultOpen = true,
		children
	}: {
		appId: string;
		title?: string;
		defaultOpen?: boolean;
		children: Snippet;
	} = $props();

	// Get initial state from localStorage or use default
	const storageKey = `help-${appId}-collapsed`;

	function getInitialState(): boolean {
		if (browser) {
			const stored = localStorage.getItem(storageKey);
			if (stored !== null) {
				return stored !== 'true'; // stored is 'true' when collapsed
			}
		}
		return defaultOpen;
	}

	let isOpen = $state(getInitialState());

	// Persist to localStorage when changed
	function toggle() {
		isOpen = !isOpen;
		if (browser) {
			localStorage.setItem(storageKey, String(!isOpen));
		}
	}
</script>

<div class="rounded-xl border border-white/10 bg-white/5">
	<button
		type="button"
		onclick={toggle}
		class="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-white/5"
	>
		<span class="flex items-center gap-2 text-sm font-medium text-white">
			<Icon icon="tabler:help-circle" class="h-4 w-4 text-solar-300" />
			{title}
		</span>
		<Icon
			icon={isOpen ? 'tabler:chevron-up' : 'tabler:chevron-down'}
			class="h-4 w-4 text-solar-300/60"
		/>
	</button>
	{#if isOpen}
		<div class="border-t border-white/10 px-3 pb-3 pt-2 text-sm text-solar-300/80" transition:slide>
			{@render children()}
		</div>
	{/if}
</div>
