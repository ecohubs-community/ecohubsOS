<script lang="ts">
	import Icon from '@iconify/svelte';

	// Four chat-bubble tiles. Each tile uses a single tail-cut corner
	// (alternating left/right) so the row reads as a back-and-forth
	// conversation rather than four uniform cards.
	const channels = [
		{
			icon: 'tabler:speakerphone',
			title: 'Announcements',
			subtitle: 'News and what\'s happening',
			ring: 'from-emerald-400/40 to-emerald-500/10',
			iconColor: 'text-emerald-300',
			tailLeft: true
		},
		{
			icon: 'tabler:messages',
			title: 'Discussions',
			subtitle: 'Day-to-day conversation',
			ring: 'from-teal-400/40 to-teal-500/10',
			iconColor: 'text-teal-300',
			tailLeft: false
		},
		{
			icon: 'tabler:calendar-event',
			title: 'Meetings',
			subtitle: 'Community calls & gatherings',
			ring: 'from-amber-400/40 to-amber-500/10',
			iconColor: 'text-amber-300',
			tailLeft: true
		},
		{
			icon: 'tabler:link',
			title: 'Resources',
			subtitle: 'Articles, tools, links',
			ring: 'from-lime-400/40 to-lime-500/10',
			iconColor: 'text-lime-300',
			tailLeft: false
		}
	];
</script>

<div class="discord-illustration relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-900/30 via-teal-900/20 to-solar-900/40 p-4 sm:p-5">
	<!-- Decorative leaves & sparkles, pointer-events none. Mirrors the
	     Puckstack card so the two steps feel like a set. -->
	<div class="pointer-events-none absolute inset-0">
		<Icon
			icon="tabler:leaf"
			class="absolute -top-2 -right-2 h-16 w-16 rotate-12 text-emerald-400/15"
		/>
		<Icon
			icon="tabler:plant-2"
			class="absolute -bottom-3 -left-3 h-20 w-20 -rotate-12 text-teal-400/10"
		/>
		<Icon
			icon="tabler:message-circle-2"
			class="absolute top-3 left-6 h-4 w-4 text-amber-300/40"
		/>
		<Icon
			icon="tabler:sparkles"
			class="absolute right-8 bottom-6 h-3 w-3 text-lime-300/40"
		/>
	</div>

	<!-- Header -->
	<div class="relative mb-3 flex items-center gap-2 sm:mb-4">
		<div class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20">
			<Icon icon="tabler:messages" class="h-4 w-4 text-emerald-300" />
		</div>
		<h4 class="text-sm font-semibold text-white sm:text-base">
			What you'll find on Discord
		</h4>
	</div>

	<!-- Chat-bubble grid: 2×2 on mobile, 1×4 on desktop. -->
	<div class="relative grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
		{#each channels as ch (ch.title)}
			<div
				class="group relative overflow-hidden border border-white/10 bg-white/5 p-3 transition-all hover:border-white/20 hover:bg-white/[0.07]
					{ch.tailLeft ? 'rounded-2xl rounded-tl-sm' : 'rounded-2xl rounded-tr-sm'}"
			>
				<!-- Soft halo behind the icon -->
				<div
					class="absolute h-12 w-12 rounded-full bg-gradient-to-br {ch.ring} blur-md transition-opacity group-hover:opacity-80
						{ch.tailLeft ? '-top-4 -left-4' : '-top-4 -right-4'}"
				></div>

				<div class="relative flex flex-col gap-1.5">
					<Icon icon={ch.icon} class="h-5 w-5 {ch.iconColor}" />
					<div class="text-xs font-semibold text-white sm:text-sm">{ch.title}</div>
					<div class="text-[11px] leading-snug text-white/60 sm:text-xs">
						{ch.subtitle}
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Footer flow chips -->
	<div class="relative mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-white/55 sm:mt-4 sm:text-xs">
		<span class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">Drop in</span>
		<Icon icon="tabler:arrow-narrow-right" class="h-3 w-3 text-white/30" />
		<span class="rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 text-teal-200">
			Text or voice
		</span>
		<Icon icon="tabler:arrow-narrow-right" class="h-3 w-3 text-white/30" />
		<span class="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
			<Icon icon="tabler:hearts" class="h-3 w-3" />
			Connect with members
		</span>
	</div>
</div>
