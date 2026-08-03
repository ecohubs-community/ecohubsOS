<script lang="ts">
	import Icon from '@iconify/svelte';
	import { portal } from '$lib/actions/portal';
	import ApplicationFields from '$lib/components/ApplicationFields.svelte';
	import { obscureEmail } from '$lib/utils/email.utils';

	interface Props {
		applicationId: string | null;
		open: boolean;
		onClose: () => void;
	}

	let { applicationId, open, onClose }: Props = $props();

	interface Application {
		id: string;
		fullName: string;
		email: string;
		formData: string;
		submittedAt: string;
		aiRecommendation: string | null;
	}

	let application = $state<Application | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Re-fetch whenever the modal opens for an application we don't hold yet.
	$effect(() => {
		if (!open || !applicationId) return;
		if (application?.id === applicationId) return;
		load(applicationId);
	});

	async function load(id: string) {
		loading = true;
		error = null;
		application = null;
		try {
			const res = await fetch(`/api/applications/${id}`);
			if (!res.ok) {
				throw new Error(
					res.status === 404
						? 'This application is not available to you.'
						: `Failed to load application (${res.status})`
				);
			}
			const data = await res.json();
			application = data.application;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load application';
		} finally {
			loading = false;
		}
	}

	const formData = $derived.by((): Record<string, unknown> => {
		if (!application) return {};
		try {
			return JSON.parse(application.formData) as Record<string, unknown>;
		} catch {
			return { fullName: application.fullName, email: application.email };
		}
	});

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString();
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

{#if open}
	<div
		class="modal-backdrop"
		use:portal
		onclick={handleBackdrop}
		onkeydown={handleKey}
		role="dialog"
		aria-modal="true"
		aria-label="Full application"
		tabindex="-1"
	>
		<div class="modal">
			<div class="modal-header">
				<div>
					<h2>Full application</h2>
					{#if application}
						<p class="sub">
							{application.fullName} · {obscureEmail(application.email)} · Submitted {fmtDate(
								application.submittedAt
							)}
						</p>
					{/if}
				</div>
				<button type="button" class="close-btn" onclick={onClose} aria-label="Close">
					<Icon icon="tabler:x" class="h-4 w-4" />
				</button>
			</div>

			<div class="modal-body">
				{#if loading}
					<p class="hint">Loading application…</p>
				{:else if error}
					<div class="error">{error}</div>
				{:else if application}
					<ApplicationFields {formData} aiRecommendation={application.aiRecommendation} />
				{/if}
			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-ghost" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
	}
	.modal {
		background: #1a1a1f;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 14px;
		width: min(720px, 92vw);
		display: flex;
		flex-direction: column;
		max-height: 90vh;
		overflow: hidden;
	}
	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.2rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.modal-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.sub {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.5);
	}
	.close-btn {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.5);
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 6px;
	}
	.close-btn:hover {
		color: white;
		background: rgba(255, 255, 255, 0.08);
	}
	.modal-body {
		padding: 1.2rem;
		overflow-y: auto;
	}
	.hint {
		margin: 0;
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.85rem;
	}
	.error {
		padding: 0.6rem 0.8rem;
		background: rgba(239, 68, 68, 0.12);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 8px;
		color: #fca5a5;
		font-size: 0.85rem;
	}
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		padding: 0.9rem 1.2rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}
	.btn {
		border: none;
		border-radius: 8px;
		padding: 0.55rem 1.1rem;
		font-weight: 500;
		cursor: pointer;
		font-size: 0.9rem;
	}
	.btn-ghost {
		background: rgba(255, 255, 255, 0.06);
		color: white;
	}
	.btn-ghost:hover {
		background: rgba(255, 255, 255, 0.12);
	}
</style>
