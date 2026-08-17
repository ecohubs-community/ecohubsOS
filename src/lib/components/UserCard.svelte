<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import { auth } from '$lib/auth.svelte';
	import type { Role } from '$lib/policy';
	import { authClient } from '$lib/auth-client';
	import { offcoin } from '$lib/offcoin.svelte';
	import { levelProgress } from '$lib/utils/balances.utils';
	import { goto } from '$app/navigation';
	import { os } from '$lib/os.svelte';

	let { showWallet = false, delay = 200 }: { showWallet?: boolean; delay?: number } = $props();

	// Badge per role, resolved from `auth.role` rather than a raw group string,
	// so it can never disagree with what the policy actually grants. Trial is
	// shown too — a member should be able to see where they stand, not have to
	// infer it from what they cannot do.
	//
	// Class strings are written out in full: Tailwind scans source text, so a
	// composed name like `bg-${colour}-500/20` would never be generated.
	const ROLE_BADGE: Record<Role, { label: string; class: string }> = {
		trial: { label: 'Trial', class: 'bg-amber-500/20 text-amber-300' },
		member: { label: 'Member', class: 'bg-blue-500/20 text-blue-300' },
		steward: { label: 'Steward', class: 'bg-emerald-500/20 text-emerald-300' },
		admin: { label: 'Admin', class: 'bg-indigo-500/20 text-indigo-300' }
	};

	function openProfile() {
		os.openApp('my-profile');
	}

	let isLoadingLogout = $state(false);

	// Progress *within* the current level. The old reading divided total XP by
	// the XP still owed, which is a ratio of two unrelated quantities: it passed
	// 100% as soon as a member was half way up their band and sat near zero
	// before that, so the bar only ever looked full or empty.
	const progress = $derived(levelProgress(offcoin.xp, offcoin.level));

	async function handleLogout() {
		isLoadingLogout = true;

		// Ask where to end the Authentik session *before* signing out — the id
		// token is looked up by user id, and after sign-out there is no session to
		// look it up with.
		//
		// Clearing only the local session left Authentik's own session alive, so
		// the next "Sign in with Authentik" was answered silently and the member
		// appeared never to have logged out at all.
		let ssoLogoutUrl: string | null = null;
		try {
			const res = await fetch('/api/sso-logout');
			if (res.ok) ssoLogoutUrl = (await res.json()).url ?? null;
		} catch {
			// Fall through to a local-only logout.
		}

		try {
			await authClient.signOut();
			auth.clearUser();
		} catch {
			// Ignore errors
		}

		// A full page navigation, not `goto` — the destination is another origin.
		if (ssoLogoutUrl) {
			window.location.href = ssoLogoutUrl;
			return;
		}
		goto('/login');
	}
</script>

<div
	class="glass-panel group col-span-1 cursor-default rounded-2xl p-4 sm:col-span-6 md:col-span-6 md:p-5 lg:col-span-4 xl:col-span-3"
	in:fly={{ y: 20, delay }}
>
	<div class="relative mb-4 flex items-center gap-3">
		<button
			type="button"
			onclick={openProfile}
			title="Edit Profile"
			class="absolute -top-1 -right-1 rounded-full p-1 text-white/0 transition-all group-hover:text-white/40 hover:!bg-white/10 hover:!text-white"
		>
			<Icon icon="tabler:pencil" class="h-3.5 w-3.5" />
		</button>
		<button
			type="button"
			onclick={openProfile}
			class="to-purle-600 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-indigo-400 font-bold text-indigo-200/80 shadow-lg transition-all hover:ring-2 hover:ring-white/30"
		>
			{#if offcoin.isLoading}
				<Icon icon="tabler:loader-2" class="h-5 w-5 animate-spin" />
			{:else if auth.userAvatar}
				<img
					in:fade
					src={auth.userAvatar}
					alt="Avatar"
					class="absolute h-10 w-10 rounded-full object-cover"
				/>
			{:else if offcoin.isConnected && offcoin.avatarUrl}
				<img
					in:fade
					src={offcoin.avatarUrl}
					alt="Avatar"
					class="absolute h-10 w-10 rounded-full object-cover"
				/>
			{:else if offcoin.isConnected}
				{offcoin.name[0]}
			{:else}
				{auth.userName?.[0] ?? '?'}
			{/if}
		</button>
		<div class="min-w-0 flex-1">
			{#if offcoin.isLoading}
				<div class="mb-2 h-4 w-20 animate-pulse rounded-md bg-white/20"></div>
				<div class="flex gap-2">
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
					<div class="h-2 w-10 animate-pulse rounded-md bg-white/20"></div>
				</div>
			{:else}
				<button type="button" onclick={openProfile} class="cursor-pointer text-left">
					<h3
						class="leading-tight font-bold text-white transition-colors hover:text-white/80"
						in:fade
					>
						{#if auth.user?.displayName && offcoin.isConnected}
							{auth.user.displayName} / {offcoin.name}
						{:else if auth.user?.displayName}
							{auth.user.displayName}
						{:else if offcoin.isConnected}
							{offcoin.name}
						{:else}
							{auth.userName ?? 'Anonymous'}
						{/if}
					</h3>
				</button>
				<!-- `hasMemberData`, not just `isConnected`: a failed lookup leaves the
				     store at its fallback 0, and printing "Lvl 0" there states
				     something about the member we never actually read. -->
				{#if offcoin.isConnected && offcoin.hasMemberData}
					<p class="text-solar-300 text-xs">{offcoin.role} • Lvl {offcoin.level}</p>
				{:else}
					<p class="text-solar-300 text-xs">{auth.userEmail ?? 'Member'}</p>
				{/if}
				<div class="mt-0.5 flex flex-wrap items-center gap-1.5">
					<span class="rounded-full px-2 py-0.5 text-xs {ROLE_BADGE[auth.role].class}">
						{ROLE_BADGE[auth.role].label}
					</span>
					<!-- Status is orthogonal to role: a standby steward is still a
					     steward, so this sits beside the role rather than replacing it. -->
					{#if auth.membershipStatus === 'standby'}
						<span class="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">Standby</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	{#if !offcoin.isLoading}
		{#if offcoin.isConnected && !offcoin.hasMemberData}
			<!-- Connected but the lookup did not land. Saying so beats drawing an
			     empty bar under "Lvl 0", which reads as a fact about them. -->
			<p class="text-solar-300/60 text-xs">
				{offcoin.error ?? 'Could not load your Offcoin XP right now.'}
			</p>
		{:else if offcoin.isConnected}
			<div class="space-y-2" in:fade>
				<div class="flex justify-between text-xs opacity-70">
					<span>{progress.xpIntoLevel} / {progress.levelSpan} XP to Lvl {progress.level + 1}</span>
					<span>{progress.percent}%</span>
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-black/20">
					<div
						class="h-full bg-linear-to-r from-indigo-500 to-purple-300"
						style="width: {Math.max(progress.percent, 1)}%"
					></div>
				</div>
			</div>
		{:else}
			<p class="text-solar-300/60 text-xs">
				Connect to Offcoin via onboarding to see your XP and level.
			</p>
		{/if}
	{/if}
	{#if showWallet}
		<div
			class="text-solar-300/60 mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs"
		>
			<div class="flex items-center gap-2">
				{#if auth.walletAddress}
					<Icon icon="tabler:wallet" class="h-4 w-4" />
					<span>{auth.shortWalletAddress}</span>
					{#if auth.isSafeOwner}
						<span class="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300"
							>Safe Owner</span
						>
					{/if}
				{:else}
					<Icon icon="tabler:wallet-off" class="h-4 w-4" />
					<span>No wallet connected</span>
				{/if}
			</div>
			<div>
				<button
					onclick={handleLogout}
					class="rounded-md bg-red-500/20 px-2 py-1 text-red-300 transition-colors hover:bg-red-500/30 hover:text-red-400"
				>
					{#if isLoadingLogout}
						<Icon icon="tabler:loader-2" class="h-4 w-4 animate-spin" />
					{:else}
						Logout
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
