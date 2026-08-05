<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { badges } from '$lib/badges.svelte';

	interface Recipient {
		id: string;
		name: string;
		role: string;
		level: number;
	}
	interface GrantRow {
		id: string;
		recipientName: string;
		actorName: string;
		eco: number;
		xp: number;
		reason: string;
		announced: boolean;
		createdAt: string | null;
	}

	let recipients = $state<Recipient[]>([]);
	let recent = $state<GrantRow[]>([]);
	let limits = $state({ maxEcoPerGrant: 66, ecoToXpRatio: 1.5, xpRemainingToday: 500 });

	let loading = $state(true);
	let recipientId = $state('');
	let eco = $state(10);
	let reason = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// One number, two currencies. The steward picks the ECO; the XP follows at
	// the same ratio Puckstack uses, so the same contribution is worth the same
	// wherever it is recognised — and nobody has to reason about two sliders.
	const xp = $derived(Math.max(0, Math.round(eco * limits.ecoToXpRatio)));
	const overDailyLimit = $derived(xp > limits.xpRemainingToday);
	const recipient = $derived(recipients.find((r) => r.id === recipientId) ?? null);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/rewards');
			if (res.ok) {
				const data = await res.json();
				recipients = data.recipients ?? [];
				recent = data.recent ?? [];
				limits = data.limits ?? limits;
				if (eco > limits.maxEcoPerGrant) eco = limits.maxEcoPerGrant;
			}
		} finally {
			loading = false;
		}
	}

	async function submit() {
		error = null;
		success = null;
		submitting = true;
		try {
			const res = await fetch('/api/rewards', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ recipientUserId: recipientId, eco, reason })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message ?? 'Could not grant');

			success = data.levelledUp
				? `Sent — and that took them to Level ${data.newLevel}.`
				: 'Sent, and posted to Discord.';
			reason = '';
			recipientId = '';
			await load();
			badges.refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not grant';
		} finally {
			submitting = false;
		}
	}

	onMount(load);
</script>

<div class="flex h-full flex-col overflow-y-auto">
	<div class="border-b border-white/10 px-4 py-3">
		<h1 class="text-base font-semibold text-white">Grant rewards</h1>
		<p class="text-xs text-white/40">
			Recognise a contribution. Every grant is posted to Discord — who, what for, how much.
		</p>
	</div>

	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-8 w-8 animate-spin text-white/40" />
		</div>
	{:else}
		<div class="space-y-4 p-4">
			<!-- Who -->
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-white/60">Who</span>
				<select
					bind:value={recipientId}
					class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
				>
					<option value="">Choose a member…</option>
					{#each recipients as r (r.id)}
						<option value={r.id}>{r.name} — {r.role}, Level {r.level}</option>
					{/each}
				</select>
				{#if recipients.length === 0}
					<p class="mt-1 text-xs text-amber-300/70">
						Nobody has connected Offcoin yet, so there is nobody to grant to.
					</p>
				{/if}
			</label>

			<!-- How much: one slider, both currencies -->
			<div>
				<div class="mb-2 flex items-baseline justify-between">
					<span class="text-xs font-medium text-white/60">How much</span>
					<span class="text-xs text-white/40">
						{limits.xpRemainingToday} XP left today
					</span>
				</div>
				<div class="rounded-xl border border-white/10 bg-white/5 p-4">
					<div class="mb-3 flex items-center justify-center gap-6">
						<div class="text-center">
							<div class="font-mono text-2xl font-bold text-amber-300">{eco}</div>
							<div class="text-[11px] tracking-wide text-white/40 uppercase">ECO</div>
						</div>
						<Icon icon="tabler:plus" class="h-4 w-4 text-white/20" />
						<div class="text-center">
							<div class="font-mono text-2xl font-bold text-emerald-300">{xp}</div>
							<div class="text-[11px] tracking-wide text-white/40 uppercase">XP</div>
						</div>
					</div>
					<input
						type="range"
						min="1"
						max={limits.maxEcoPerGrant}
						bind:value={eco}
						class="w-full accent-indigo-400"
					/>
					<div class="flex justify-between text-[11px] text-white/30">
						<span>1</span>
						<span>max {limits.maxEcoPerGrant}</span>
					</div>
					<p class="mt-2 text-center text-[11px] text-white/30">
						XP follows ECO at {limits.ecoToXpRatio}× — the same rate as Puckstack tasks.
					</p>
				</div>
				{#if overDailyLimit}
					<p class="mt-1 text-xs text-amber-300">That is more XP than you have left today.</p>
				{/if}
			</div>

			<!-- What for -->
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-white/60">
					What for
					<span class="font-normal text-white/30">— this appears in the Discord post</span>
				</span>
				<input
					bind:value={reason}
					placeholder="e.g. ran the Tuesday call and wrote up the notes"
					maxlength="200"
					class="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
				/>
			</label>

			{#if error}
				<p class="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">
					{error}
				</p>
			{/if}
			{#if success}
				<p
					class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-sm text-emerald-300"
				>
					{success}
				</p>
			{/if}

			<button
				type="button"
				onclick={submit}
				disabled={submitting || !recipientId || reason.trim().length < 5 || overDailyLimit}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-40"
			>
				{#if submitting}
					<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
				{:else}
					<Icon icon="tabler:gift" class="h-4 w-4" />
				{/if}
				{recipient ? `Grant to ${recipient.name}` : 'Grant'}
			</button>

			<!-- Recent -->
			{#if recent.length > 0}
				<div class="pt-2">
					<h2 class="mb-2 text-xs font-medium text-white/60">Recently granted</h2>
					<ul class="space-y-1.5">
						{#each recent as g (g.id)}
							<li class="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
								<div class="flex items-baseline justify-between gap-2">
									<span class="text-white/80">
										{g.actorName} → <span class="font-medium text-white">{g.recipientName}</span>
									</span>
									<span class="shrink-0 font-mono text-white/50">
										{g.eco} ECO / {g.xp} XP
									</span>
								</div>
								<p class="mt-0.5 truncate text-white/40">{g.reason}</p>
								{#if !g.announced}
									<p class="mt-0.5 text-[11px] text-amber-300/70">Not posted to Discord</p>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
