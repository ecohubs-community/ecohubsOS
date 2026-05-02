<script lang="ts">
	import Icon from '@iconify/svelte';

	// Four "what you'll get" tiles. Each one has an icon, a single noun
	// headline, and a short sub-line. Colour cycles through the regen
	// palette (emerald → teal → amber → solar) so the row reads as a
	// flow rather than four uniform cards.
	const features = [
		{
			icon: 'tabler:stars',
			title: 'Earn XP',
			subtitle: 'Every contribution levels you up',
			ring: 'from-emerald-400/40 to-emerald-500/10',
			iconColor: 'text-emerald-300'
		},
		{
			icon: 'tabler:coin-filled',
			title: 'ECO tokens',
			subtitle: 'Credit for the work you do',
			ring: 'from-teal-400/40 to-teal-500/10',
			iconColor: 'text-teal-300'
		},
		{
			icon: 'tabler:checklist',
			title: 'Take on tasks',
			subtitle: 'Community quests waiting',
			ring: 'from-amber-400/40 to-amber-500/10',
			iconColor: 'text-amber-300'
		},
		{
			icon: 'tabler:trophy',
			title: 'See the team',
			subtitle: 'Leaderboard of contributions',
			ring: 'from-lime-400/40 to-lime-500/10',
			iconColor: 'text-lime-300'
		}
	];
</script>

<div class="puckstack-illustration relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-900/30 via-teal-900/20 to-solar-900/40 p-4 sm:p-5">
	<!-- Decorative leaves & sparkles, absolutely positioned. Pointer-events
	     none so they never interfere with clicks. -->
	<div class="pointer-events-none absolute inset-0">
		<Icon
			icon="tabler:leaf"
			class="absolute -top-2 -left-2 h-16 w-16 -rotate-12 text-emerald-400/15"
		/>
		<Icon
			icon="tabler:plant-2"
			class="absolute -right-3 -bottom-3 h-20 w-20 rotate-12 text-teal-400/10"
		/>
		<Icon icon="tabler:sparkles" class="absolute top-3 right-6 h-4 w-4 text-amber-300/40" />
		<Icon
			icon="tabler:sparkles"
			class="absolute bottom-6 left-8 h-3 w-3 text-lime-300/40"
		/>
	</div>

	<!-- Header -->
	<div class="relative mb-3 flex items-center gap-2 sm:mb-4">
		<div class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20">
			<Icon icon="tabler:sparkles" class="h-4 w-4 text-emerald-300" />
		</div>
		<h4 class="text-sm font-semibold text-white sm:text-base">
			What you'll get with Puckstack
		</h4>
	</div>

	<!-- Feature grid: 2×2 on mobile, 1×4 on desktop. -->
	<div class="relative grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
		{#each features as feat (feat.title)}
			<div
				class="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3 transition-all hover:border-white/20 hover:bg-white/[0.07]"
			>
				<!-- Soft halo behind the icon for depth -->
				<div
					class="absolute -top-4 -left-4 h-12 w-12 rounded-full bg-gradient-to-br {feat.ring} blur-md transition-opacity group-hover:opacity-80"
				></div>

				<div class="relative flex flex-col gap-1.5">
					<Icon icon={feat.icon} class="h-5 w-5 {feat.iconColor}" />
					<div class="text-xs font-semibold text-white sm:text-sm">{feat.title}</div>
					<div class="text-[11px] leading-snug text-white/60 sm:text-xs">
						{feat.subtitle}
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Footer flow: levels → permissions hint -->
	<div class="relative mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-white/55 sm:mt-4 sm:text-xs">
		<span class="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">XP</span>
		<Icon icon="tabler:arrow-narrow-right" class="h-3 w-3 text-white/30" />
		<span class="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
			Levels
		</span>
		<Icon icon="tabler:arrow-narrow-right" class="h-3 w-3 text-white/30" />
		<span class="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
			More permissions
		</span>
	</div>
</div>
