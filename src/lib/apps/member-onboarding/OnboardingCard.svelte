<script lang="ts">
	import Icon from '@iconify/svelte';
	import { type OnboardingCard, fmtRelative } from './types';

	let { card, onclick }: { card: OnboardingCard; onclick: () => void } = $props();

	const initials = $derived(
		card.fullName
			.split(/\s+/)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('')
	);

	// A card needs steward attention when it's waiting on a manual action.
	const needsAction = $derived(
		(card.stage === 'reminder' && !card.reminderSentAt) ||
			(card.stage === 'logged_in' && !card.buddyCallInvitedAt)
	);
</script>

<button
	type="button"
	{onclick}
	class="group w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left transition-all hover:border-white/25 hover:bg-white/10"
>
	<div class="flex items-center gap-3">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-teal-400 to-emerald-600 text-xs font-bold text-white"
		>
			{#if card.avatarUrl}
				<img src={card.avatarUrl} alt="" class="h-full w-full object-cover" />
			{:else}
				{initials || '?'}
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="truncate text-sm font-medium text-white">{card.fullName}</div>
			<div class="truncate text-xs text-white/40">{card.email}</div>
		</div>
		{#if needsAction}
			<span
				class="flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ring-2 ring-amber-400/30"
				title="Needs a steward action"
			></span>
		{/if}
	</div>

	<div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
		{#if card.stage === 'accepted' || card.stage === 'reminder'}
			<span class="rounded-md bg-white/5 px-1.5 py-0.5 text-white/50">
				Accepted {fmtRelative(card.acceptedAt)}
			</span>
		{/if}
		{#if card.stage === 'reminder' && card.reminderSentAt}
			<span class="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
				Reminded {fmtRelative(card.reminderSentAt)}
			</span>
		{:else if card.stage === 'reminder'}
			<span class="rounded-md bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-300">
				Reminder due
			</span>
		{/if}
		{#if card.stage === 'logged_in' && !card.buddyCallInvitedAt}
			<span class="rounded-md bg-violet-500/20 px-1.5 py-0.5 font-medium text-violet-300">
				Invite to buddy call
			</span>
		{/if}
		{#if card.buddyCallAt}
			<span class="rounded-md bg-teal-500/15 px-1.5 py-0.5 text-teal-300">
				Call {fmtRelative(card.buddyCallAt)}
			</span>
		{:else if card.buddyCallSkippedAt}
			<span class="rounded-md bg-white/5 px-1.5 py-0.5 text-white/40"> Call skipped </span>
		{:else if card.buddyCallInvitedAt && card.stage === 'buddy_call'}
			<span class="rounded-md bg-teal-500/15 px-1.5 py-0.5 text-teal-300"> Invited </span>
		{/if}
		{#if card.noteCount > 0}
			<span class="flex items-center gap-0.5 rounded-md bg-white/5 px-1.5 py-0.5 text-white/40">
				<Icon icon="tabler:notes" class="h-3 w-3" />
				{card.noteCount}
			</span>
		{/if}
	</div>
</button>
