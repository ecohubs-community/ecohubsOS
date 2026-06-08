<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';

	// State
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isUploadingAvatar = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// Editable profile fields
	let displayName = $state('');
	let bio = $state('');
	let languages = $state('');
	let location = $state('');
	let contribution = $state('');
	let avatarUrl = $state<string | null>(null);
	let avatarPreview = $state<string | null>(null);
	let avatarBlob = $state<Blob | null>(null);
	let showOnWebsite = $state(true);
	let meetingSchedulingUrl = $state('');

	// Read-only derived from auth store
	let userName = $derived(auth.user?.name ?? '');
	let userEmail = $derived(auth.user?.email ?? '');
	let walletAddress = $derived(auth.user?.walletAddress ?? null);
	let shortWallet = $derived(auth.shortWalletAddress);
	let isAdmin = $derived(auth.userGroups.includes('EcoHubs Admin'));
	let isStewardOrAdmin = $derived(auth.isStewardOrAdmin);

	let fileInput = $state<HTMLInputElement>(undefined!);
	let successTimeout: ReturnType<typeof setTimeout>;

	onMount(async () => {
		try {
			const res = await fetch('/api/profile');
			if (!res.ok) throw new Error('Failed to load profile');
			const data = await res.json();
			displayName = data.displayName ?? '';
			bio = data.bio ?? '';
			languages = data.languages ?? '';
			location = data.location ?? '';
			contribution = data.contribution ?? '';
			avatarUrl = data.avatar;
			showOnWebsite = data.showOnWebsite ?? true;
			meetingSchedulingUrl = data.meetingSchedulingUrl ?? '';
		} catch (err) {
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

	function scaleImage(
		file: File,
		maxSize: number
	): Promise<{ dataUrl: string; blob: Blob }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const objectUrl = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(objectUrl);
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
			img.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error('Failed to load image'));
			};
			img.src = objectUrl;
		});
	}

	async function handleSave() {
		if (isSaving) return;
		isSaving = true;
		error = null;
		success = null;

		try {
			// Upload avatar if changed
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
				avatarPreview = null;
				avatarBlob = null;
				isUploadingAvatar = false;

				// Update auth store avatar
				if (auth.user) {
					auth.setUser({ ...auth.user, avatar: avatarUrl });
				}
			}

			// Save text fields
			const res = await fetch('/api/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName,
					bio,
					languages,
					location,
					contribution,
					showOnWebsite,
					// Only persisted server-side for stewards/admins.
					...(isStewardOrAdmin ? { meetingSchedulingUrl } : {})
				})
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message || 'Failed to save profile');
			}

			// Update auth store
			if (auth.user) {
				auth.setUser({
					...auth.user,
					displayName: displayName || null,
					bio: bio || null,
					languages: languages || null,
					location: location || null,
					contribution: contribution || null,
					showOnWebsite,
					...(isStewardOrAdmin ? { meetingSchedulingUrl: meetingSchedulingUrl || null } : {})
				});
			}

			success = 'Profile saved successfully';
			clearTimeout(successTimeout);
			successTimeout = setTimeout(() => (success = null), 3000);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save profile';
		} finally {
			isSaving = false;
			isUploadingAvatar = false;
		}
	}

	function copyWallet() {
		if (walletAddress) {
			navigator.clipboard.writeText(walletAddress);
		}
	}
</script>

<div class="h-full overflow-y-auto p-4 sm:p-6">
	{#if isLoading}
		<div class="flex h-64 items-center justify-center">
			<Icon icon="tabler:loader-2" class="h-8 w-8 animate-spin text-white/50" />
		</div>
	{:else}
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Status Messages -->
			{#if error}
				<div
					class="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
				>
					<Icon icon="tabler:alert-circle" class="h-4 w-4 shrink-0" />
					{error}
				</div>
			{/if}

			{#if success}
				<div
					class="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
				>
					<Icon icon="tabler:check" class="h-4 w-4 shrink-0" />
					{success}
				</div>
			{/if}

			<!-- Header: Avatar + Identity -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<div class="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
					<!-- Avatar -->
					<button
						type="button"
						onclick={() => fileInput.click()}
						class="group relative h-24 w-24 shrink-0 overflow-hidden rounded-full bg-linear-to-br from-teal-400 to-emerald-600 ring-2 ring-white/20 transition-all hover:ring-white/40"
					>
						{#if avatarPreview}
							<img
								src={avatarPreview}
								alt="Avatar preview"
								class="h-full w-full object-cover"
							/>
						{:else if avatarUrl}
							<img
								src={avatarUrl}
								alt="Avatar"
								class="h-full w-full object-cover"
							/>
						{:else if auth.userImage}
							<img
								src={auth.userImage}
								alt="Avatar"
								class="h-full w-full object-cover"
							/>
						{:else}
							<span class="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
								{userName?.[0]?.toUpperCase() ?? '?'}
							</span>
						{/if}
						<div
							class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
						>
							<Icon icon="tabler:camera" class="h-6 w-6 text-white" />
						</div>
					</button>
					<input
						bind:this={fileInput}
						type="file"
						accept="image/jpeg,image/png,image/webp"
						class="hidden"
						onchange={handleAvatarSelect}
					/>

					<!-- Identity Info -->
					<div class="flex-1 space-y-3 text-center sm:text-left">
						<div>
							<h2 class="text-xl font-bold text-white">{userName}</h2>
							<p class="text-sm text-white/50">{userEmail}</p>
						</div>
						<div class="flex flex-wrap justify-center gap-2 sm:justify-start">
							{#if isAdmin}
								<span
									class="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-300"
								>
									Admin
								</span>
							{:else}
								<span
									class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300"
								>
									Member
								</span>
							{/if}
						</div>
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
					placeholder="Choose a display name..."
					maxlength={100}
					class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				/>
				<p class="mt-1.5 text-xs text-white/30">
					This overrides your SSO name for display purposes
				</p>
			</div>

			<!-- Wallet -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<span class="mb-2 block text-sm font-medium text-white/70">Wallet</span>
				{#if walletAddress}
					<div class="flex items-center gap-2">
						<div
							class="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/70"
						>
							{shortWallet}
						</div>
						<button
							type="button"
							onclick={copyWallet}
							class="rounded-xl border border-white/10 bg-white/5 p-3 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
							title="Copy full address"
						>
							<Icon icon="tabler:copy" class="h-5 w-5" />
						</button>
					</div>
				{:else}
					<div
						class="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/30"
					>
						No wallet connected
					</div>
				{/if}
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
					placeholder="Tell us about yourself..."
					maxlength={2000}
					rows={4}
					class="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
				></textarea>
			</div>

			<!-- Languages & Location -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
					<label for="languages" class="mb-2 block text-sm font-medium text-white/70">
						<Icon icon="tabler:language" class="mr-1 inline h-4 w-4" />
						Languages
					</label>
					<input
						id="languages"
						type="text"
						bind:value={languages}
						placeholder="e.g., English, German, Spanish"
						maxlength={200}
						class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
					/>
				</div>

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
			</div>

			<!-- Contribution -->
			<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
				<div class="mb-2 flex items-center justify-between">
					<label for="contribution" class="text-sm font-medium text-white/70">
						Contribution
					</label>
					<span class="text-xs text-white/30">{contribution.length}/2000</span>
				</div>
				<textarea
					id="contribution"
					bind:value={contribution}
					placeholder="How would you like to contribute..."
					maxlength={2000}
					rows={3}
					class="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
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
						We will show your avatar, display name, bio, languages, location & contribution on the website. If unchecked, only your display name, XP & ECO token balance will be shown.
					</p>
				</div>
			</label>
		</div>

			<!-- Buddy-call scheduling URL (stewards & admins only) -->
			{#if isStewardOrAdmin}
				<div class="rounded-2xl border border-white/10 bg-white/5 p-5">
					<label
						for="meetingSchedulingUrl"
						class="mb-2 block text-sm font-medium text-white/70"
					>
						<Icon icon="tabler:calendar-clock" class="mr-1 inline h-4 w-4" />
						Buddy-call scheduling URL
					</label>
					<input
						id="meetingSchedulingUrl"
						type="url"
						bind:value={meetingSchedulingUrl}
						placeholder="https://cal.com/you/buddy-call"
						maxlength={500}
						class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
					/>
					<p class="mt-1.5 text-xs text-white/30">
						Your personal Cal.com / Calendly link. Used to pre-fill the buddy-call
						invitation email in the Member Onboarding app. Leave empty to fall back to the
						community calendar.
					</p>
				</div>
			{/if}

		<!-- Actions -->
			<div class="flex flex-col gap-3 pb-4 sm:flex-row">
				<button
					type="button"
					onclick={handleSave}
					disabled={isSaving}
					class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-teal-500 to-emerald-500 px-6 py-3 font-medium text-white shadow-lg transition-all hover:from-teal-400 hover:to-emerald-400 hover:shadow-xl disabled:opacity-50"
				>
					{#if isSaving}
						<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
						{isUploadingAvatar ? 'Uploading avatar...' : 'Saving...'}
					{:else}
						<Icon icon="tabler:device-floppy" class="h-5 w-5" />
						Save Changes
					{/if}
				</button>

				<a
					href="https://sso.mediakular.com/if/flow/default-password-change/"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 font-medium text-white/70 transition-all hover:bg-white/10 hover:text-white"
				>
					<Icon icon="tabler:key" class="h-5 w-5" />
					Change Password
					<Icon icon="tabler:external-link" class="h-4 w-4" />
				</a>
			</div>
		</div>
	{/if}
</div>
