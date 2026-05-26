<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { offcoin } from '$lib/offcoin.svelte';
	import { auth } from '$lib/auth.svelte';
	import { os } from '$lib/os.svelte';
	import { contributions } from '$lib/contributions.svelte';
	import { SOCIAL_LINKS, DISCORD_URL, PUCKSTACK_LINKS } from '$lib/contributions/contributionData';

	let { delay = 350 }: { delay?: number } = $props();

	let socialExpanded = $state(false);
	let refreshing = $state(false);

	function openExternal(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await contributions.refresh();
		} finally {
			refreshing = false;
		}
	}

	// Static, checkable items. Completed ("checked") items sink to the very
	// bottom of the card (below the dynamic to-dos); unchecked stay on top.
	type StaticItem =
		| { kind: 'social'; id: string }
		| { kind: 'link'; id: string; icon: string; title: string; url: string };

	const staticItems: StaticItem[] = [
		{ kind: 'social', id: 'social-follow' },
		{
			kind: 'link',
			id: 'introduce-yourself',
			icon: 'tabler:message-2',
			title: 'Introduce yourself in Discord',
			url: DISCORD_URL
		}
	];

	const uncheckedStatic = $derived(staticItems.filter((i) => !contributions.isDone(i.id)));
	const checkedStatic = $derived(staticItems.filter((i) => contributions.isDone(i.id)));

	// Social sub-links, unchecked first / checked last.
	const sortedSocialLinks = $derived(
		[...SOCIAL_LINKS].sort(
			(a, b) => Number(contributions.isDone(a.id)) - Number(contributions.isDone(b.id))
		)
	);

	// Profile is "incomplete" when none of the descriptive fields are filled.
	const profileIncomplete = $derived(
		!auth.user?.bio?.trim() && !auth.user?.avatar?.trim() && !auth.user?.location?.trim()
	);

	// Dynamic items only show for Puckstack members, and each only when its
	// count > 0. Voting + profile are independent of Puckstack membership.
	const showPuckstack = $derived(!!offcoin.puckstackUserId && contributions.isMember);

	interface DynamicItem {
		id: string;
		icon: string;
		title: string;
		count?: number;
		onOpen: () => void;
	}

	const dynamicItems = $derived.by<DynamicItem[]>(() => {
		const items: DynamicItem[] = [];
		if (showPuckstack) {
			if (contributions.counts.unreadNotifications > 0)
				items.push({
					id: 'puckstack-notifications',
					icon: 'tabler:bell',
					title: 'Unread Puckstack notifications',
					count: contributions.counts.unreadNotifications,
					onOpen: () => openExternal(PUCKSTACK_LINKS.notifications)
				});
			if (contributions.counts.tasksNeedingReview > 0)
				items.push({
					id: 'puckstack-review',
					icon: 'tabler:checkbox',
					title: 'Tasks needing review',
					count: contributions.counts.tasksNeedingReview,
					onOpen: () => openExternal(PUCKSTACK_LINKS.review)
				});
			if (contributions.counts.openTasks > 0)
				items.push({
					id: 'puckstack-open',
					icon: 'tabler:list-check',
					title: 'Open tasks to work on',
					count: contributions.counts.openTasks,
					onOpen: () => openExternal(PUCKSTACK_LINKS.open)
				});
		}
		if (contributions.votingCount > 0)
			items.push({
				id: 'voting',
				icon: 'tabler:gavel',
				title: 'Vote on active proposals',
				count: contributions.votingCount,
				onOpen: () => os.openApp('voting')
			});
		if (profileIncomplete)
			items.push({
				id: 'complete-profile',
				icon: 'tabler:user-edit',
				title: 'Complete your profile',
				onOpen: () => os.openApp('my-profile')
			});
		return items;
	});

	$effect(() => {
		contributions.loadProgress();
		contributions.loadVotingCount();
	});

	// Fetch Puckstack counts once the puckstackUserId resolves (it arrives
	// asynchronously after offcoin bootstraps).
	$effect(() => {
		if (offcoin.puckstackUserId) contributions.loadCounts();
	});
</script>

<div
	class="glass-panel col-span-1 cursor-default rounded-2xl p-4 sm:col-span-6 md:col-span-6 md:p-5 lg:col-span-4 xl:col-span-3"
	in:fly={{ y: 20, delay }}
>
	<div class="mb-3 flex items-center gap-2">
		<Icon icon="tabler:sparkles" class="h-4 w-4 text-emerald-300" />
		<h3 class="text-sm font-semibold text-white">Immediate Contributions</h3>
		<button
			type="button"
			class="contrib-refresh ml-auto"
			onclick={refresh}
			disabled={refreshing}
			aria-label="Refresh contributions"
			title="Refresh"
		>
			<Icon icon="tabler:refresh" class="h-3.5 w-3.5 {refreshing ? 'animate-spin' : ''}" />
		</button>
	</div>

	{#snippet checkButton(id: string, label: string)}
		<button
			type="button"
			class="contrib-check"
			class:done={contributions.isDone(id)}
			onclick={() => contributions.toggle(id)}
			aria-pressed={contributions.isDone(id)}
			aria-label={`Toggle ${label} done`}
			title={contributions.isDone(id) ? 'Mark not done' : 'Mark done'}
		>
			<Icon
				icon={contributions.isDone(id) ? 'tabler:circle-check-filled' : 'tabler:circle'}
				class="h-4 w-4"
			/>
		</button>
	{/snippet}

	{#snippet staticItem(item: StaticItem)}
		{#if item.kind === 'social'}
			<!-- Follow us on social media (expandable, markable) -->
			<div class="contrib-item">
				<button
					type="button"
					class="contrib-row"
					onclick={() => (socialExpanded = !socialExpanded)}
					aria-expanded={socialExpanded}
				>
					<Icon icon="tabler:heart-handshake" class="contrib-icon" />
					<span class="contrib-title">Follow us on social media</span>
					<Icon
						icon="tabler:chevron-right"
						class="contrib-chevron {socialExpanded ? 'rotate-90' : ''}"
					/>
				</button>
				{@render checkButton('social-follow', 'follow-us')}
			</div>

			{#if socialExpanded}
				<div class="social-sub" transition:slide={{ duration: 150 }}>
					{#each sortedSocialLinks as link (link.id)}
						<div class="contrib-item sub">
							<button type="button" class="contrib-row" onclick={() => openExternal(link.url)}>
								<Icon icon={link.icon} class="contrib-icon" />
								<span class="contrib-title">{link.label}</span>
								<Icon icon="tabler:external-link" class="contrib-ext" />
							</button>
							{@render checkButton(link.id, link.label)}
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Simple markable link item -->
			<div class="contrib-item">
				<button type="button" class="contrib-row" onclick={() => openExternal(item.url)}>
					<Icon icon={item.icon} class="contrib-icon" />
					<span class="contrib-title">{item.title}</span>
					<Icon icon="tabler:external-link" class="contrib-ext" />
				</button>
				{@render checkButton(item.id, item.title)}
			</div>
		{/if}
	{/snippet}

	<div class="flex flex-col gap-1.5">
		<!-- Unchecked static items first -->
		{#each uncheckedStatic as item (item.id)}
			{@render staticItem(item)}
		{/each}

		<!-- Dynamic, link-only to-dos -->
		{#each dynamicItems as item (item.id)}
			<div class="contrib-item">
				<button type="button" class="contrib-row" onclick={item.onOpen}>
					<Icon icon={item.icon} class="contrib-icon" />
					<span class="contrib-title">{item.title}</span>
					{#if item.count !== undefined}
						<span class="contrib-count">{item.count}</span>
					{/if}
					<Icon icon="tabler:arrow-right" class="contrib-ext" />
				</button>
			</div>
		{/each}

		<!-- Checked (completed) static items sink to the bottom -->
		{#each checkedStatic as item (item.id)}
			{@render staticItem(item)}
		{/each}
	</div>
</div>

<style>
	.contrib-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-radius: 0.6rem;
		transition: background 0.15s ease;
	}
	.contrib-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}
	.contrib-item.sub {
		padding-left: 1.1rem;
	}
	.contrib-row {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0.5rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		color: inherit;
		min-width: 0;
	}
	.contrib-title {
		flex: 1;
		min-width: 0;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.85);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.contrib-icon) {
		height: 1rem;
		width: 1rem;
		flex-shrink: 0;
		color: rgba(255, 255, 255, 0.6);
	}
	:global(.contrib-chevron) {
		height: 0.85rem;
		width: 0.85rem;
		flex-shrink: 0;
		color: rgba(255, 255, 255, 0.4);
		transition: transform 0.15s ease;
	}
	:global(.contrib-ext) {
		height: 0.85rem;
		width: 0.85rem;
		flex-shrink: 0;
		color: rgba(255, 255, 255, 0.35);
	}
	.contrib-count {
		flex-shrink: 0;
		min-width: 1.25rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 600;
		color: #6ee7b7;
		background: rgba(16, 185, 129, 0.15);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}
	.contrib-check {
		flex-shrink: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.3rem;
		color: rgba(255, 255, 255, 0.35);
		transition: color 0.15s ease;
	}
	.contrib-check:hover {
		color: rgba(255, 255, 255, 0.7);
	}
	.contrib-check.done {
		color: #34d399;
	}
	.contrib-refresh {
		flex-shrink: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 0.4rem;
		color: rgba(255, 255, 255, 0.45);
		transition: color 0.15s ease;
	}
	.contrib-refresh:hover {
		color: rgba(255, 255, 255, 0.85);
	}
	.contrib-refresh:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.social-sub {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
</style>
