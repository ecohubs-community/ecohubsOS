<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';
	import { os } from '$lib/os.svelte';
	import { markSubStepCompletedById } from '$lib/onboarding/stepManager';

	// `markSubStepCompletedById` dispatches an `onboarding-step-completed`
	// event which the OnboardingWizard listens for and uses to dismiss the
	// frame. When opened from the regular dock (not onboarding), the
	// component is just inside a Window — closing via os.closeApp() is the
	// right move there. We do both: the wizard close path is the primary
	// flow, os.closeApp() is the fallback for any non-onboarding entry.

	let isLoading = $state(true);
	let isSaving = $state(false);
	let isUploadingAvatar = $state(false);
	let error = $state<string | null>(null);

	// Editable fields — pre-filled from existing profile, falling back to
	// the user's membership application data.
	let displayName = $state('');
	let bio = $state('');
	let location = $state('');
	let contribution = $state('');
	let avatarUrl = $state<string | null>(null);
	let avatarPreview = $state<string | null>(null);
	let avatarBlob = $state<Blob | null>(null);
	let showOnWebsite = $state(true);

	let userName = $derived(auth.user?.name ?? '');
	let fileInput = $state<HTMLInputElement>(undefined!);

	onMount(async () => {
		try {
			const [profileRes, prefillRes] = await Promise.all([
				fetch('/api/profile'),
				fetch('/api/profile/application-prefill')
			]);

			const profile = profileRes.ok ? await profileRes.json() : {};
			const prefill = prefillRes.ok ? await prefillRes.json() : {};

			// Profile value (if set) wins over application pre-fill.
			displayName = profile.displayName || prefill.displayName || '';
			bio = profile.bio || prefill.bio || '';
			location = profile.location || prefill.location || '';
			contribution = profile.contribution || prefill.contribution || '';
			avatarUrl = profile.avatar ?? null;
			showOnWebsite = profile.showOnWebsite ?? true;
		} catch {
			error = 'Failed to load profile data';
		} finally {
			isLoading = false;
		}
	});

	async function handleAvatarSelect(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
			error = 'Please select a JPEG, PNG, or WebP image';
			return;
		}

		error = null;
		try {
			const scaled = await scaleImage(file, 1024);
			avatarPreview = scaled.dataUrl;
			avatarBlob = scaled.blob;
		} catch {
			error = 'Failed to process image';
		}
	}

	function scaleImage(file: File, maxSize: number): Promise<{ dataUrl: string; blob: Blob }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				let { width, height } = img;
				if (width > maxSize || height > maxSize) {
					if (width > height) {
						height = Math.round((height / width) * maxSize);
						width = maxSize;
					} else {
						width = Math.round((width / height) * maxSize);
						height = maxSize;
					}
				}
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) return reject(new Error('Canvas not supported'));
				ctx.drawImage(img, 0, 0, width, height);
				const dataUrl = canvas.toDataURL('image/webp', 0.85);
				canvas.toBlob(
					(blob) => {
						if (!blob) return reject(new Error('Failed to create blob'));
						resolve({ dataUrl, blob });
					},
					'image/webp',
					0.85
				);
			};
			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = URL.createObjectURL(file);
		});
	}

	async function handleSaveAndContinue() {
		if (isSaving) return;
		isSaving = true;
		error = null;

		try {
			if (avatarBlob) {
				isUploadingAvatar = true;
				const formData = new FormData();
				formData.append('avatar', avatarBlob, 'avatar.webp');
				const avatarRes = await fetch('/api/profile/avatar', {
					method: 'POST',
					body: formData
				});
				if (!avatarRes.ok) {
					const data = await avatarRes.json().catch(() => ({}));
					throw new Error(data.message || 'Failed to upload avatar');
				}
				const avatarData = await avatarRes.json();
				avatarUrl = avatarData.avatarUrl;
				if (auth.user) auth.setUser({ ...auth.user, avatar: avatarUrl });
				isUploadingAvatar = false;
			}

			const res = await fetch('/api/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName,
					bio,
					location,
					contribution,
					showOnWebsite
				})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || 'Failed to save profile');
			}

			if (auth.user) {
				auth.setUser({
					...auth.user,
					displayName: displayName || null,
					bio: bio || null,
					location: location || null,
					contribution: contribution || null,
					showOnWebsite
				});
			}

			markSubStepCompletedById('profile-setup');
			os.closeApp();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save profile';
		} finally {
			isSaving = false;
			isUploadingAvatar = false;
		}
	}

	function handleSkip() {
		markSubStepCompletedById('profile-setup');
		os.closeApp();
	}
</script>

<div class="h-full overflow-y-auto p-4 sm:p-6">
	{#if isLoading}
		<div class="flex h-64 items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-8 w-8 animate-spin text-white/50" />
		</div>
	{:else}
		<div class="mx-auto max-w-2xl space-y-5">
			<div class="text-center">
				<div
					class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500"
				>
					<Icon icon="tabler:user-circle" class="h-7 w-7 text-emerald-900" />
				</div>
				<h2 class="text-lg font-bold text-white">Set up your profile</h2>
				<p class="text-solar-300 mt-1 text-sm">
					Tell other members a bit about you. We've pre-filled some fields from your
					application — feel free to edit them, or skip and finish later.
				</p>
			</div>

			{#if error}
				<div
					class="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
				>
					<Icon icon="tabler:alert-circle" class="h-4 w-4 shrink-0" />
					{error}
				</div>
			{/if}

			<!-- Avatar -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
					<button
						type="button"
						onclick={() => fileInput.click()}
						class="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-linear-to-br from-teal-400 to-emerald-600 ring-2 ring-white/20 transition-all hover:ring-white/40"
					>
						{#if avatarPreview}
							<img src={avatarPreview} alt="Avatar preview" class="h-full w-full object-cover" />
						{:else if avatarUrl}
							<img src={avatarUrl} alt="Avatar" class="h-full w-full object-cover" />
						{:else if auth.userImage}
							<img src={auth.userImage} alt="Avatar" class="h-full w-full object-cover" />
						{:else}
							<span class="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
								{userName?.[0]?.toUpperCase() ?? '?'}
							</span>
						{/if}
						<div
							class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
						>
							<Icon icon="tabler:camera" class="h-5 w-5 text-white" />
						</div>
					</button>
					<input
						bind:this={fileInput}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						class="hidden"
						onchange={handleAvatarSelect}
					/>
					<div class="flex-1 text-center sm:text-left">
						<p class="text-sm font-medium text-white/80">Profile photo</p>
						<p class="mt-1 text-xs text-white/40">
							Click the avatar to upload. JPEG, PNG, or WebP, scaled to 1024px max.
						</p>
					</div>
				</div>
			</div>

			<!-- Display Name -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<label for="displayName" class="mb-2 block text-sm font-medium text-white/70">
					Display Name
				</label>
				<input
					id="displayName"
					type="text"
					bind:value={displayName}
					placeholder="How other members will see you"
					maxlength={100}
					class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				/>
			</div>

			<!-- Location -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<label for="location" class="mb-2 block text-sm font-medium text-white/70">
					<Icon icon="tabler:map-pin" class="mr-1 inline h-4 w-4" />
					Location
				</label>
				<input
					id="location"
					type="text"
					bind:value={location}
					placeholder="e.g., Berlin, Germany"
					maxlength={200}
					class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				/>
			</div>

			<!-- Bio -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<div class="mb-2 flex items-center justify-between">
					<label for="bio" class="text-sm font-medium text-white/70">Bio</label>
					<span class="text-xs text-white/30">{bio.length}/2000</span>
				</div>
				<textarea
					id="bio"
					bind:value={bio}
					placeholder="A short introduction…"
					maxlength={2000}
					rows={4}
					class="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				></textarea>
			</div>

			<!-- Contribution -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<div class="mb-2 flex items-center justify-between">
					<label for="contribution" class="text-sm font-medium text-white/70">
						How you want to contribute
					</label>
					<span class="text-xs text-white/30">{contribution.length}/2000</span>
				</div>
				<textarea
					id="contribution"
					bind:value={contribution}
					placeholder="What you'd like to bring to the community…"
					maxlength={2000}
					rows={3}
					class="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				></textarea>
			</div>

			<!-- Website Visibility -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<label class="flex cursor-pointer items-start gap-3">
					<input
						type="checkbox"
						bind:checked={showOnWebsite}
						class="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-white/10 text-teal-500 accent-teal-500"
					/>
					<div>
						<span class="text-sm font-medium text-white">
							Display my profile on the EcoHubs website as a project contributor
						</span>
						<p class="mt-1 text-xs text-white/40">
							Shows your avatar, display name, bio, location and contribution publicly. If
							unchecked, only your display name and Offcoin XP / ECO balance are shown.
						</p>
					</div>
				</label>
			</div>

			<!-- Actions -->
			<div class="flex flex-col gap-3 pb-4 sm:flex-row">
				<button
					type="button"
					onclick={handleSkip}
					disabled={isSaving}
					class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-medium text-white/70 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50"
				>
					I'll do it later
				</button>

				<button
					type="button"
					onclick={handleSaveAndContinue}
					disabled={isSaving}
					class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-teal-500 to-emerald-500 px-6 py-3 font-medium text-white shadow-lg transition-all hover:from-teal-400 hover:to-emerald-400 disabled:opacity-50"
				>
					{#if isSaving}
						<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
						{isUploadingAvatar ? 'Uploading…' : 'Saving…'}
					{:else}
						<Icon icon="tabler:check" class="h-5 w-5" />
						Save & Continue
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
