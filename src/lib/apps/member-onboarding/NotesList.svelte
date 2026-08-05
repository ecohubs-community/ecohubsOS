<script lang="ts">
	import Icon from '@iconify/svelte';
	import { type OnboardingNote, fmtDate } from './types';

	let {
		onboardingId,
		notes,
		onChanged
	}: { onboardingId: string; notes: OnboardingNote[]; onChanged: () => void } = $props();

	let newText = $state('');
	let adding = $state(false);
	let editingId = $state<string | null>(null);
	let editText = $state('');
	let busyId = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function addNote() {
		if (!newText.trim() || adding) return;
		adding = true;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: newText })
			});
			if (!res.ok) throw new Error('Failed to add note');
			newText = '';
			onChanged();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add note';
		} finally {
			adding = false;
		}
	}

	function startEdit(note: OnboardingNote) {
		editingId = note.id;
		editText = note.text;
	}

	async function saveEdit(noteId: string) {
		if (!editText.trim() || busyId) return;
		busyId = noteId;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/notes/${noteId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: editText })
			});
			if (!res.ok) throw new Error('Failed to save note');
			editingId = null;
			onChanged();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save note';
		} finally {
			busyId = null;
		}
	}

	async function deleteNote(noteId: string) {
		if (busyId) return;
		busyId = noteId;
		error = null;
		try {
			const res = await fetch(`/api/onboarding-board/${onboardingId}/notes/${noteId}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error('Failed to delete note');
			onChanged();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete note';
		} finally {
			busyId = null;
		}
	}
</script>

<div class="space-y-3">
	<!-- Add new -->
	<div class="rounded-xl border border-white/10 bg-white/5 p-3">
		<textarea
			bind:value={newText}
			placeholder="Add a note…"
			rows={2}
			class="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-teal-400 focus:outline-none"
		></textarea>
		<div class="mt-2 flex justify-end">
			<button
				type="button"
				onclick={addNote}
				disabled={adding || !newText.trim()}
				class="flex items-center gap-1.5 rounded-lg bg-teal-500/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-400 disabled:opacity-40"
			>
				{#if adding}
					<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
				{:else}
					<Icon icon="tabler:plus" class="h-4 w-4" />
				{/if}
				Add note
			</button>
		</div>
	</div>

	{#if error}
		<div class="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
			{error}
		</div>
	{/if}

	{#if notes.length === 0}
		<p class="px-1 text-sm text-white/30">No notes yet.</p>
	{/if}

	{#each notes as note (note.id)}
		<div class="rounded-xl border border-white/10 bg-white/5 p-3">
			{#if editingId === note.id}
				<textarea
					bind:value={editText}
					rows={3}
					class="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-none"
				></textarea>
				<div class="mt-2 flex justify-end gap-2">
					<button
						type="button"
						onclick={() => (editingId = null)}
						class="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={() => saveEdit(note.id)}
						disabled={busyId === note.id}
						class="rounded-lg bg-teal-500/90 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-400 disabled:opacity-40"
					>
						Save
					</button>
				</div>
			{:else}
				<p class="text-sm whitespace-pre-wrap text-white/90">{note.text}</p>
				<div class="mt-2 flex items-center justify-between">
					<span class="text-xs text-white/40">
						{note.createdBy ?? 'Unknown'} · {fmtDate(note.createdAt)}
						{#if note.updatedAt && note.updatedAt !== note.createdAt}<span class="italic">
								(edited)</span
							>{/if}
					</span>
					<div class="flex items-center gap-1">
						<button
							type="button"
							onclick={() => startEdit(note)}
							class="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
							title="Edit"
							aria-label="Edit note"
						>
							<Icon icon="tabler:pencil" class="h-4 w-4" />
						</button>
						<button
							type="button"
							onclick={() => deleteNote(note.id)}
							disabled={busyId === note.id}
							class="rounded-md p-1 text-white/40 hover:bg-red-500/20 hover:text-red-300"
							title="Delete"
							aria-label="Delete note"
						>
							<Icon icon="tabler:trash" class="h-4 w-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/each}
</div>
