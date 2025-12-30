<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { os, WALLPAPERS } from '$lib/os.svelte';
	import Icon from '@iconify/svelte';

	function close() {
		os.closeApp();
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
	transition:fade
	onclick={close}
	role="presentation"
>
	<div
		class="glass-panel flex h-[500px] w-[600px] flex-col overflow-hidden rounded-2xl shadow-2xl"
		transition:scale={{ start: 0.95 }}
		onclick={(e) => e.stopPropagation()}
		role="dialog"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-panel)] bg-white/5 px-4"
		>
			<span class="font-medium">System Settings</span>
			<button onclick={close} class="rounded-full p-1.5 hover:bg-white/10">
				<Icon icon="tabler:x" class="h-4 w-4" />
			</button>
		</div>

		<div class="flex-1 space-y-8 overflow-y-auto p-6">
			<section class="space-y-3">
				<h3 class="flex items-center gap-2 text-sm font-bold tracking-wider uppercase opacity-70">
					<Monitor size={14} /> UI Contrast
				</h3>
				<div class="grid grid-cols-3 gap-3">
					<button
						class="flex flex-col items-center gap-2 rounded-xl border p-3 transition-all"
						class:bg-white-20={os.contrastMode === 'auto'}
						class:border-solar-400={os.contrastMode === 'auto'}
						class:border-transparent={os.contrastMode !== 'auto'}
						onclick={() => (os.contrastMode = 'auto')}
					>
						<Icon icon="tabler:wand" class="text-gold-400" />
						<span class="text-sm">Auto</span>
					</button>

					<button
						class="flex flex-col items-center gap-2 rounded-xl border p-3 transition-all"
						class:bg-white-20={os.contrastMode === 'light'}
						class:border-solar-400={os.contrastMode === 'light'}
						class:border-transparent={os.contrastMode !== 'light'}
						onclick={() => (os.contrastMode = 'light')}
					>
						<Icon icon="tabler:moon" class="text-solar-400" />	
						<span class="text-sm">Frost (Light)</span>
					</button>

					<button
						class="flex flex-col items-center gap-2 rounded-xl border p-3 transition-all"
						class:bg-white-20={os.contrastMode === 'dark'}
						class:border-solar-400={os.contrastMode === 'dark'}
						class:border-transparent={os.contrastMode !== 'dark'}
						onclick={() => (os.contrastMode = 'dark')}
					>
						<Icon icon="tabler:sun" class="text-solar-400" />
						<span class="text-sm">Smoke (Dark)</span>
					</button>
				</div>
				<p class="px-1 text-xs opacity-50">
					{#if os.contrastMode === 'auto'}
						System automatically chooses the best contrast for your wallpaper.
					{:else if os.contrastMode === 'light'}
						Best for dark backgrounds.
					{:else}
						Best for bright backgrounds.
					{/if}
				</p>
			</section>

			<hr class="border-[var(--border-panel)]" />

			<section class="space-y-3">
				<h3 class="text-sm font-bold tracking-wider uppercase opacity-70">Wallpaper</h3>
				<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
					{#each WALLPAPERS as wp (wp.id)}
						<button
							class="group relative aspect-square overflow-hidden rounded-xl border-2 transition-all hover:scale-105"
							class:border-gold-400={os.currentWallpaper.id === wp.id}
							class:border-transparent={os.currentWallpaper.id !== wp.id}
							onclick={() => os.setWallpaper(wp.id)}
						>
							{#if wp.url}
								<img src={wp.url} alt={wp.name} class="h-full w-full object-cover" />
							{:else}
								<div class="h-full w-full" style="background-color: {wp.color}"></div>
							{/if}

							{#if os.currentWallpaper.id === wp.id}
								<div class="absolute inset-0 flex items-center justify-center bg-black/40">
									<Icon icon="tabler:check" class="text-gold-400 drop-shadow-md" />
								</div>
							{/if}

							<div
								class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-center text-xs text-white"
							>
								{wp.name}
							</div>
						</button>
					{/each}
				</div>
			</section>
		</div>
	</div>
</div>
