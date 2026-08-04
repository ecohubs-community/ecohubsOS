<script lang="ts">
	import Icon from '@iconify/svelte';

	let { data } = $props();

	let reason = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let submitted = $state(false);

	// NB: not named `state` — that shadows the $state rune in this scope.
	const requestState = $derived(data.reactivation.state);

	async function submit() {
		submitError = null;
		submitting = true;
		try {
			const res = await fetch('/api/membership/reactivation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reason })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? 'Could not submit your request');
			}
			submitted = true;
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Could not submit your request';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Membership on standby — ecohubsOS</title></svelte:head>

<main class="standby-root">
	<div class="card">
		<div class="head">
			<Icon icon="tabler:player-pause" class="h-6 w-6" />
			<h1>Your membership is on standby</h1>
		</div>

		{#if data.standbyReason}
			<p class="muted">Noted at the time: {data.standbyReason}</p>
		{/if}

		{#if submitted || requestState === 'pending'}
			<p>
				Great — your request is with the community. Active members have three days to vote, and
				we'll email you the result.
			</p>
			<p class="muted">
				You won't see the vote itself while it runs. That's deliberate: it keeps the decision free
				of campaigning, in either direction.
			</p>
		{:else if requestState === 'needs_review'}
			<p>
				Your request needs a closer look from a steward. They'll be in touch — there's nothing more
				for you to do right now.
			</p>
		{:else if data.reactivation.cooldownUntil}
			<p>Your last request wasn't approved.</p>
			<p class="muted">
				You can ask again after {new Date(data.reactivation.cooldownUntil).toLocaleDateString()}.
			</p>
		{:else}
			<p>
				Great that you want to reactivate your membership. Tell us a little about why, and we'll put
				it to the community — a three-day vote, and we'll email you the result.
			</p>

			<label class="field">
				<span>Your reason</span>
				<textarea
					bind:value={reason}
					rows="5"
					maxlength="2000"
					placeholder="What you'd like to pick up again, and what changed…"
				></textarea>
			</label>

			{#if submitError}
				<p class="error">{submitError}</p>
			{/if}

			<button class="primary" onclick={submit} disabled={submitting || reason.trim().length < 10}>
				{submitting ? 'Sending…' : 'Send request'}
			</button>
		{/if}
	</div>
</main>

<style>
	.standby-root {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: #0f2e2e;
		color: rgba(255, 255, 255, 0.92);
	}
	.card {
		width: 100%;
		max-width: 34rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 16px;
		padding: 1.8rem;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	h1 {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0;
	}
	p {
		margin: 0 0 0.9rem;
		line-height: 1.6;
		font-size: 0.95rem;
	}
	.muted {
		color: rgba(255, 255, 255, 0.6);
		font-size: 0.88rem;
	}
	.field {
		display: block;
		margin: 1.2rem 0 1rem;
	}
	.field span {
		display: block;
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
		color: rgba(255, 255, 255, 0.75);
	}
	textarea {
		width: 100%;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 10px;
		padding: 0.7rem;
		color: white;
		font: inherit;
		resize: vertical;
	}
	.error {
		color: #fca5a5;
		font-size: 0.88rem;
	}
	.primary {
		background: rgb(99, 102, 241);
		color: white;
		border: none;
		padding: 0.6rem 1.1rem;
		border-radius: 9px;
		font-weight: 500;
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
