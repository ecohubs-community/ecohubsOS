<script lang="ts">
	/**
	 * What a member sees instead of an app they cannot open yet.
	 *
	 * Opening the feedback widget straight from the grid was faster but opaque:
	 * a form appeared with no statement of what was locked or why, so the member
	 * had to infer both. This says it plainly first, and makes asking a
	 * deliberate second step rather than the only thing that happens.
	 *
	 * The explanation comes from `can()` rather than being written here, so the
	 * reason a member reads is the same rule the server enforces.
	 */
	import Icon from '@iconify/svelte';
	import { os } from '$lib/os.svelte';
	import { auth } from '$lib/auth.svelte';
	import { isRequestable } from '$lib/policy';
	import type { AppDefinition } from '$lib/data';

	let { app }: { app: AppDefinition } = $props();

	let result = $derived(app.requires ? auth.can(app.requires) : null);

	/** Narrowed to the denial, which is the only branch carrying `message`. */
	let denial = $derived(result && !result.allowed ? result : null);

	/**
	 * Only a grant is worth asking for, which is exactly what `isRequestable`
	 * decides — reused rather than restated, so the button and the policy cannot
	 * drift apart. A capability withheld for role or membership status is reached
	 * by taking part, and a button would misrepresent how to get there.
	 */
	let requestable = $derived(!!result && isRequestable(result));

	function requestAccess() {
		os.openFeedback({
			subject: `Access request: ${app.name}`,
			message:
				`I'd like access to ${app.name}.\n\n` +
				`What I'd like to contribute:\n\n` +
				`(Currently locked: ${denial?.message ?? app.description})`
		});
	}
</script>

<div class="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
	<div
		class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5"
	>
		<Icon icon="tabler:lock" class="h-7 w-7 text-white/40" />
	</div>

	<h2 class="text-solar-100 mb-2 text-lg font-medium">{app.name} is locked</h2>

	<p class="text-solar-300/80 max-w-md text-sm leading-relaxed">
		{denial?.message ?? app.description}
	</p>

	{#if requestable}
		<p class="text-solar-400/60 mt-4 max-w-md text-xs leading-relaxed">
			This one is granted on request. Tell a steward what you would like to work on and they can
			open it up for you.
		</p>
		<button
			type="button"
			onclick={requestAccess}
			class="bg-solar-600 hover:bg-solar-500 mt-6 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
		>
			<Icon icon="tabler:send" class="h-4 w-4" />
			Request access
		</button>
		<p class="text-solar-400/40 mt-3 text-xs">Opens a message you can edit before sending.</p>
	{:else}
		<p class="text-solar-400/60 mt-4 max-w-md text-xs leading-relaxed">
			This is not something to request — it opens up as your membership does.
		</p>
	{/if}
</div>
