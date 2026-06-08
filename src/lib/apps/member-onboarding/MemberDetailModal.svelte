<script lang="ts">
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { portal } from '$lib/actions/portal';
	import { type OnboardingDetail, STAGE_META, fmtDate, standbyFollowUpDue } from './types';
	import NotesList from './NotesList.svelte';
	import EmailComposerModal from './EmailComposerModal.svelte';

	// Rendered only while active (parent guards with {#if}/{#key}), so the
	// member detail is loaded on mount rather than via an $effect on `open`.
	let {
		onboardingId,
		onClose,
		onUpdated
	}: {
		onboardingId: string;
		onClose: () => void;
		onUpdated: () => void;
	} = $props();

	let detail = $state<OnboardingDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let composerOpen = $state(false);
	let composerKind = $state<'reminder' | 'buddyCall'>('reminder');

	let showLogForm = $state(false);
	let logDate = $state('');
	let logWith = $state('');
	let logBusy = $state(false);
	let skipBusy = $state(false);
	let dormantBusy = $state(false);
	let standbyBusy = $state(false);
	let showStandbyForm = $state(false);
	let standbyUntil = $state('');

	onMount(load);

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}`);
			if (!res.ok) throw new Error('Failed to load member detail');
			detail = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	// Refresh detail + parent board after any mutation.
	function refresh() {
		load();
		onUpdated();
	}

	function openComposer(kind: 'reminder' | 'buddyCall') {
		composerKind = kind;
		composerOpen = true;
	}

	function onComposerDone() {
		composerOpen = false;
		refresh();
	}

	async function logBuddyCall() {
		if (logBusy) return;
		logBusy = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/buddy-call/log`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date: logDate || new Date().toISOString(), withWhom: logWith })
			});
			if (!res.ok) throw new Error('Failed to log buddy call');
			showLogForm = false;
			logWith = '';
			logDate = '';
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to log buddy call';
		} finally {
			logBusy = false;
		}
	}

	async function toggleSkip(skip: boolean) {
		if (skipBusy) return;
		skipBusy = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/buddy-call/skip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ skip })
			});
			if (!res.ok) throw new Error('Failed to update buddy-call status');
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update buddy-call status';
		} finally {
			skipBusy = false;
		}
	}

	async function toggleDormant(dormant: boolean) {
		if (dormantBusy) return;
		dormantBusy = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/dormant`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dormant })
			});
			if (!res.ok) throw new Error('Failed to update status');
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update status';
		} finally {
			dormantBusy = false;
		}
	}

	async function toggleStandby(standby: boolean) {
		if (standbyBusy) return;
		standbyBusy = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/standby`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ standby, until: standby ? standbyUntil || null : null })
			});
			if (!res.ok) throw new Error('Failed to update status');
			showStandbyForm = false;
			standbyUntil = '';
			refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update status';
		} finally {
			standbyBusy = false;
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	const eventIcon: Record<string, string> = {
		accepted: 'tabler:user-plus',
		reminder_sent: 'tabler:mail-forward',
		logged_in: 'tabler:login',
		buddy_call_invited: 'tabler:calendar-plus',
		buddy_call_held: 'tabler:phone-check',
		buddy_call_skipped: 'tabler:calendar-off',
		buddy_call_unskipped: 'tabler:calendar-plus',
		set_dormant: 'tabler:user-off',
		reactivated: 'tabler:user-check',
		set_standby: 'tabler:player-pause',
		resumed: 'tabler:player-play',
		note_added: 'tabler:note',
		note_edited: 'tabler:pencil',
		note_deleted: 'tabler:trash',
		completed: 'tabler:circle-check'
	};
</script>

<div
	class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
	use:portal
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={handleBackdrop}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#16161c] shadow-2xl"
	>
		{#if loading || !detail}
			<div class="flex h-64 items-center justify-center">
				{#if error}
					<p class="text-sm text-red-300">{error}</p>
				{:else}
					<Icon icon="tabler:loader-2" class="h-8 w-8 animate-spin text-white/40" />
				{/if}
			</div>
		{:else}
			{@const meta = STAGE_META[detail.stage]}
			<!-- Header -->
			<div class="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-teal-400 to-emerald-600 text-sm font-bold text-white"
					>
						{#if detail.avatarUrl}
							<img src={detail.avatarUrl} alt="" class="h-full w-full object-cover" />
						{:else}
							{detail.fullName?.[0]?.toUpperCase() ?? '?'}
						{/if}
					</div>
					<div>
						<h2 class="text-lg font-semibold text-white">{detail.fullName}</h2>
						<p class="text-xs text-white/40">{detail.email}</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<span class="rounded-full px-2.5 py-1 text-xs font-medium {meta.badgeClass}">
						{meta.label}
					</span>
					<button
						type="button"
						onclick={onClose}
						class="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
						aria-label="Close"
					>
						<Icon icon="tabler:x" class="h-5 w-5" />
					</button>
				</div>
			</div>

			<div class="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
				<!-- Left: data + actions -->
				<div class="space-y-4">
					<!-- Key dates -->
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div class="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
							<div class="text-[11px] uppercase tracking-wide text-white/40">Accepted</div>
							<div class="text-white/90">{fmtDate(detail.acceptedAt)}</div>
						</div>
						<div class="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
							<div class="text-[11px] uppercase tracking-wide text-white/40">Onboarding</div>
							<div class="text-white/90">
								{detail.onboardingCompletedAt
									? 'Complete'
									: detail.onboardingStartedAt
										? 'In progress'
										: detail.userId
											? 'Account active'
											: 'No account yet'}
							</div>
						</div>
					</div>

					<!-- Reminder action -->
					<div class="rounded-xl border border-white/10 bg-white/5 p-3">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium text-white/80">
							<Icon icon="tabler:mail-forward" class="h-4 w-4 text-amber-300" />
							Login reminder
						</div>
						{#if detail.reminderSentAt}
							<p class="mb-2 text-xs text-white/50">
								Sent {fmtDate(detail.reminderSentAt)}{detail.reminderSentBy
									? ` by ${detail.reminderSentBy}`
									: ''}
							</p>
						{:else}
							<p class="mb-2 text-xs text-white/40">Not sent yet.</p>
						{/if}
						<button
							type="button"
							onclick={() => openComposer('reminder')}
							class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10"
						>
							<Icon icon="tabler:edit" class="h-4 w-4" />
							{detail.reminderSentAt ? 'Send another reminder' : 'Compose reminder'}
						</button>
					</div>

					<!-- Buddy call action -->
					<div class="rounded-xl border border-white/10 bg-white/5 p-3">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium text-white/80">
							<Icon icon="tabler:users" class="h-4 w-4 text-teal-300" />
							Buddy call
						</div>
						{#if detail.buddyCallInvitedAt}
							<p class="text-xs text-white/50">
								Invited {fmtDate(detail.buddyCallInvitedAt)}{detail.buddyCallInvitedBy
									? ` by ${detail.buddyCallInvitedBy}`
									: ''}
							</p>
						{/if}
						{#if detail.buddyCallAt}
							<p class="text-xs text-teal-300">
								Held {fmtDate(detail.buddyCallAt)}{detail.buddyCallWith
									? ` with ${detail.buddyCallWith}`
									: ''}
							</p>
						{/if}
						{#if detail.buddyCallSkippedAt}
							<p class="text-xs text-white/50">
								Marked not needed {fmtDate(detail.buddyCallSkippedAt)}{detail.buddyCallSkippedBy
									? ` by ${detail.buddyCallSkippedBy}`
									: ''}
							</p>
						{/if}
						{#if !detail.buddyCallInvitedAt && !detail.buddyCallAt && !detail.buddyCallSkippedAt}
							<p class="mb-2 text-xs text-white/40">Not invited yet.</p>
						{/if}

						<div class="mt-2 flex flex-col gap-2">
							<button
								type="button"
								onclick={() => openComposer('buddyCall')}
								class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10"
							>
								<Icon icon="tabler:calendar-plus" class="h-4 w-4" />
								{detail.buddyCallInvitedAt ? 'Send another invite' : 'Compose buddy-call invite'}
							</button>

							{#if showLogForm}
								<div class="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
									<div>
										<label for="log-date" class="mb-1 block text-[11px] text-white/50">
											Call date
										</label>
										<input
											id="log-date"
											type="date"
											bind:value={logDate}
											class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-teal-400 focus:outline-none"
										/>
									</div>
									<div>
										<label for="log-with" class="mb-1 block text-[11px] text-white/50">
											With whom
										</label>
										<input
											id="log-with"
											type="text"
											bind:value={logWith}
											placeholder="e.g. Stefan"
											class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:border-teal-400 focus:outline-none"
										/>
									</div>
									<div class="flex justify-end gap-2">
										<button
											type="button"
											onclick={() => (showLogForm = false)}
											class="rounded-md px-2.5 py-1.5 text-sm text-white/60 hover:text-white"
										>
											Cancel
										</button>
										<button
											type="button"
											onclick={logBuddyCall}
											disabled={logBusy}
											class="rounded-md bg-teal-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-400 disabled:opacity-40"
										>
											Save call
										</button>
									</div>
								</div>
							{:else}
								<button
									type="button"
									onclick={() => (showLogForm = true)}
									class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10"
								>
									<Icon icon="tabler:phone-check" class="h-4 w-4" />
									{detail.buddyCallAt ? 'Update logged call' : 'Log buddy call'}
								</button>
							{/if}

							{#if detail.buddyCallSkippedAt}
								<button
									type="button"
									onclick={() => toggleSkip(false)}
									disabled={skipBusy}
									class="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/50 hover:text-white/80 disabled:opacity-40"
								>
									<Icon icon="tabler:arrow-back-up" class="h-4 w-4" />
									Undo “not needed”
								</button>
							{:else}
								<button
									type="button"
									onclick={() => toggleSkip(true)}
									disabled={skipBusy}
									class="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/50 hover:text-white/80 disabled:opacity-40"
									title="Skip the buddy call for this member"
								>
									<Icon icon="tabler:calendar-off" class="h-4 w-4" />
									Mark buddy call as not needed
								</button>
							{/if}
						</div>
					</div>

					<!-- Standby (engaged member who paused) -->
					{#if detail.standbyAt}
						{@const due = standbyFollowUpDue(detail.stage, detail.standbyUntil)}
						<div
							class="flex items-center justify-between gap-2 rounded-xl border p-3 {due
								? 'border-amber-500/30 bg-amber-500/10'
								: 'border-indigo-500/20 bg-indigo-500/10'}"
						>
							<div class="text-xs {due ? 'text-amber-200' : 'text-indigo-200'}">
								<div class="font-medium">{due ? 'On standby — follow-up due' : 'On standby'}</div>
								<div class="opacity-80">
									Since {fmtDate(detail.standbyAt)}{detail.standbyBy ? ` · ${detail.standbyBy}` : ''}
									· {detail.standbyUntil
										? `follow up ${fmtDate(detail.standbyUntil)}`
										: 'no follow-up date'}
								</div>
							</div>
							<button
								type="button"
								onclick={() => toggleStandby(false)}
								disabled={standbyBusy}
								class="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
							>
								<Icon icon="tabler:player-play" class="h-4 w-4" />
								Resume
							</button>
						</div>
					{:else if showStandbyForm}
						<div class="space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3">
							<div class="text-xs font-medium text-indigo-200">Put on standby</div>
							<div>
								<label for="standby-until" class="mb-1 block text-[11px] text-white/50">
									Follow up on (optional)
								</label>
								<input
									id="standby-until"
									type="date"
									bind:value={standbyUntil}
									class="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white focus:border-indigo-400 focus:outline-none"
								/>
								<p class="mt-1 text-[11px] text-white/30">
									If set, the card flags for attention once this date arrives.
								</p>
							</div>
							<div class="flex justify-end gap-2">
								<button
									type="button"
									onclick={() => {
										showStandbyForm = false;
										standbyUntil = '';
									}}
									class="rounded-md px-2.5 py-1.5 text-sm text-white/60 hover:text-white"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={() => toggleStandby(true)}
									disabled={standbyBusy}
									class="rounded-md bg-indigo-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
								>
									Put on standby
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (showStandbyForm = true)}
							class="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/40 hover:text-white/70"
							title="Pause an engaged member who asked for a break — they'll return"
						>
							<Icon icon="tabler:player-pause" class="h-4 w-4" />
							Put on standby
						</button>
					{/if}

					<!-- Set aside / reactivate (no-response handling) -->
					{#if detail.dormantAt}
						<div
							class="flex items-center justify-between gap-2 rounded-xl border border-slate-500/20 bg-slate-500/10 p-3"
						>
							<div class="text-xs text-slate-300">
								<div class="font-medium">Set aside — no response</div>
								<div class="text-slate-400">
									{fmtDate(detail.dormantAt)}{detail.dormantBy ? ` · ${detail.dormantBy}` : ''}
								</div>
							</div>
							<button
								type="button"
								onclick={() => toggleDormant(false)}
								disabled={dormantBusy}
								class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
							>
								<Icon icon="tabler:user-check" class="h-4 w-4" />
								Reactivate
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => toggleDormant(true)}
							disabled={dormantBusy}
							class="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/40 hover:text-white/70 disabled:opacity-40"
							title="Park this member out of the active flow — non-destructive and reversible"
						>
							<Icon icon="tabler:user-off" class="h-4 w-4" />
							Set aside — no response
						</button>
					{/if}

					{#if error}
						<div class="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
							{error}
						</div>
					{/if}

					<!-- Timeline -->
					<div>
						<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
							Timeline
						</h3>
						<ol class="space-y-2">
							{#each detail.events as ev (ev.id)}
								<li class="flex gap-2.5 text-sm">
									<Icon
										icon={eventIcon[ev.type] ?? 'tabler:point'}
										class="mt-0.5 h-4 w-4 shrink-0 text-white/40"
									/>
									<div class="min-w-0">
										<div class="text-white/80">{ev.detail ?? ev.type}</div>
										<div class="text-[11px] text-white/35">
											{fmtDate(ev.createdAt)}{ev.actor ? ` · ${ev.actor}` : ''}
										</div>
									</div>
								</li>
							{/each}
						</ol>
					</div>
				</div>

				<!-- Right: notes -->
				<div>
					<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Notes</h3>
					<NotesList {onboardingId} notes={detail.notes} onChanged={refresh} />
				</div>
			</div>
		{/if}
	</div>
</div>

{#if composerOpen && detail}
	<EmailComposerModal
		kind={composerKind}
		{onboardingId}
		recipientEmail={detail.email}
		initialSubject={detail.buddyCallTemplate.subject}
		initialBody={detail.buddyCallTemplate.body}
		onClose={() => (composerOpen = false)}
		onDone={onComposerDone}
	/>
{/if}
