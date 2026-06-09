<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import OnboardingDetails from './OnboardingDetails.svelte';

	type OnboardingFilter = 'All' | 'Not Started' | 'In Progress' | 'Complete' | 'Pending Login';

	interface Member {
		id: string;
		name: string;
		email: string;
		groups: string[];
		lastLogin: string | null;
		onboardingStatus: 'Complete' | 'In Progress' | 'Not Started' | 'Pending Login';
		onboardingProgress: string;
		onboardingStartedAt: string | null;
		onboardingCompletedAt: string | null;
		xp: number;
		eco: number;
		avatarUrl: string | null;
		walletAddress: string | null;
		introWatchedAt: string | null;
		pendingLogin?: boolean;
		inviteSentAt?: string | null;
	}

	let members: Member[] = $state([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeFilter = $state<OnboardingFilter>('All');

	let filteredMembers = $derived(
		activeFilter === 'All'
			? members
			: members.filter((m) => m.onboardingStatus === activeFilter)
	);

	const FILTERS: OnboardingFilter[] = ['All', 'Not Started', 'In Progress', 'Complete', 'Pending Login'];

	// Modal state
	let showOnboardingModal = $state(false);
	let selectedMember = $state<Member | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/admin/members');
			if (!res.ok) {
				if (res.status === 403) throw new Error('Access Denied: Admins only');
				throw new Error('Failed to fetch members');
			}
			const data = await res.json();
			members = data.members;
		} catch (e) {
			console.error(e);
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			isLoading = false;
		}
	});

	function getStatusColor(status: string) {
		switch (status) {
			case 'Complete':
				return 'text-green-400 bg-green-400/10 border-green-400/20';
			case 'In Progress':
				return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
			case 'Pending Login':
				return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
			default:
				return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
		}
	}

	function formatDate(dateString: string | null) {
		if (!dateString) return 'Never';
		return new Date(dateString).toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	let copiedWalletId = $state<string | null>(null);

	function shortWallet(address: string): string {
		return `${address.slice(0, 6)}...${address.slice(-4)}`;
	}

	async function copyWallet(address: string, memberId: string) {
		await navigator.clipboard.writeText(address);
		copiedWalletId = memberId;
		setTimeout(() => {
			if (copiedWalletId === memberId) copiedWalletId = null;
		}, 1500);
	}

	// Steward role assignment (Authentik group "EcoHubs Steward")
	const STEWARD_GROUP = 'EcoHubs Steward';
	let stewardBusyId = $state<string | null>(null);

	function isSteward(member: Member): boolean {
		return member.groups.includes(STEWARD_GROUP);
	}

	async function toggleSteward(member: Member) {
		if (member.pendingLogin || stewardBusyId) return;
		const action = isSteward(member) ? 'remove' : 'add';
		stewardBusyId = member.id;
		error = null;
		try {
			const res = await fetch('/api/admin/stewards', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: member.id, action })
			});
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				throw new Error(d.message || 'Failed to update steward role');
			}
			const data = await res.json();
			member.groups = data.groups;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update steward role';
		} finally {
			stewardBusyId = null;
		}
	}

	function openOnboardingDetails(member: Member) {
		selectedMember = member;
		showOnboardingModal = true;
	}

	function closeOnboardingDetails() {
		showOnboardingModal = false;
		selectedMember = null;
	}
</script>

<div class="text-solar-50 relative flex h-full min-h-full flex-col overflow-hidden bg-solar-900/50">
	{#if isLoading}
		<div class="text-solar-300 flex flex-1 items-center justify-center p-8">
			<Icon icon="svg-spinners:90-ring-with-bg" class="mr-2 h-6 w-6" />
			Loading members...
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center p-8 text-red-400">
			<Icon icon="tabler:alert-triangle" class="mr-2 h-6 w-6" />
			{error}
		</div>
	{:else}
		<div class="overflow-x-auto p-6" transition:fade>
			<div class="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<h2 class="flex items-center gap-2 text-xl font-bold">
					<Icon icon="tabler:users" class="text-solar-400 h-6 w-6" />
					Community Members
					<span
						class="text-solar-400/60 ml-2 rounded-full border border-white/5 bg-solar-900/40 px-2 py-0.5 text-sm font-normal"
					>
						{members.length} Total
					</span>
				</h2>
			</div>

			<!-- Onboarding filter tabs -->
			<div class="mb-4 flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
				{#each FILTERS as filter}
					{@const count = filter === 'All' ? members.length : members.filter((m) => m.onboardingStatus === filter).length}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
							{activeFilter === filter
							? 'bg-white/10 text-white'
							: 'text-white/50 hover:text-white/70'}"
						onclick={() => (activeFilter = filter)}
					>
						{filter}
						<span
							class="rounded-full px-1.5 py-0.5 text-[10px]
								{activeFilter === filter ? 'bg-white/10' : 'bg-white/5'}"
						>
							{count}
						</span>
					</button>
				{/each}
			</div>

			<table class="w-full border-collapse text-left text-sm">
				<thead>
					<tr class="text-solar-400/80 border-b border-white/10">
						<th class="px-4 py-3 font-medium">Member</th>
						<th class="px-4 py-3 font-medium">Groups</th>
						<th class="px-4 py-3 font-medium">Steward</th>
						<th class="px-4 py-3 font-medium">Wallet</th>
						<th class="px-4 py-3 font-medium">Intro Video</th>
						<th class="px-4 py-3 font-medium">Onboarding</th>
						<th class="px-4 py-3 font-medium">Last Login</th>
						<!-- <th class="px-4 py-3 text-right font-medium">XP</th>
						<th class="px-4 py-3 text-right font-medium">ECO</th> -->
					</tr>
				</thead>
				<tbody class="divide-y divide-white/5">
					{#each filteredMembers as member}
						<tr class="group transition-colors hover:bg-white/5">
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									<div
										class="bg-solar-800 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10"
									>
										{#if member.avatarUrl}
											<img
												src={member.avatarUrl}
												alt={member.name}
												class="h-full w-full object-cover"
											/>
										{:else}
											<span class="text-solar-400 text-xs font-bold"
												>{member.name.slice(0, 2).toUpperCase()}</span
											>
										{/if}
									</div>
									<div class="flex flex-col">
										<span class="text-solar-100 font-medium">{member.name}</span>
										<span class="text-solar-400/60 text-xs">{member.email}</span>
									</div>
								</div>
							</td>
							<td class="px-4 py-3">
								<div class="flex flex-wrap gap-1">
									{#each member.groups as group}
										{#if group === 'EcoHubs Admin'}
											<span
												class="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400"
											>
												Admin
											</span>
										{:else}
											<span
												class="text-solar-300 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium"
											>
												{group}
											</span>
										{/if}
									{/each}
								</div>
							</td>
							<td class="px-4 py-3">
								{#if member.pendingLogin}
									<span class="text-xs text-white/20">--</span>
								{:else}
									<button
										type="button"
										onclick={() => toggleSteward(member)}
										disabled={stewardBusyId === member.id}
										class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50
											{isSteward(member)
											? 'border-teal-400/30 bg-teal-400/10 text-teal-300 hover:bg-teal-400/20'
											: 'border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'}"
										title={isSteward(member) ? 'Remove steward role' : 'Make steward'}
									>
										{#if stewardBusyId === member.id}
											<Icon icon="tabler:loader-2" class="h-3 w-3 animate-spin" />
										{:else}
											<Icon
												icon={isSteward(member) ? 'tabler:check' : 'tabler:plus'}
												class="h-3 w-3"
											/>
										{/if}
										{isSteward(member) ? 'Steward' : 'Make steward'}
									</button>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if member.walletAddress}
									<div class="flex items-center gap-1">
										<span class="font-mono text-xs text-white/60">{shortWallet(member.walletAddress)}</span>
										<button
											class="text-solar-400 rounded p-0.5 transition-colors hover:bg-white/10 hover:text-white"
											onclick={() => copyWallet(member.walletAddress!, member.id)}
											title="Copy full address"
										>
											{#if copiedWalletId === member.id}
												<Icon icon="tabler:check" class="h-3.5 w-3.5 text-green-400" />
											{:else}
												<Icon icon="tabler:copy" class="h-3.5 w-3.5" />
											{/if}
										</button>
									</div>
								{:else}
									<span class="text-xs text-white/20">--</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if member.pendingLogin}
									<span class="text-xs text-white/20">--</span>
								{:else if member.introWatchedAt}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-green-400/20 bg-green-400/10 px-2 py-0.5 text-[10px] font-medium text-green-300"
										title={`Watched ${formatDate(member.introWatchedAt)}`}
									>
										<Icon icon="tabler:circle-check" class="h-3 w-3" />
										Watched
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40"
									>
										<Icon icon="tabler:player-play" class="h-3 w-3" />
										Not watched
									</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<span
										class={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(member.onboardingStatus)}`}
									>
										{member.onboardingStatus}
									</span>
									{#if !member.pendingLogin}
										<button
											class="text-solar-400 transition-colors hover:text-white"
											onclick={() => openOnboardingDetails(member)}
											title="View onboarding details"
										>
											<Icon icon="tabler:info-circle" class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</td>
							<td class="text-solar-300 px-4 py-3">
								{#if member.pendingLogin}
									<span class="text-orange-400/70 text-xs">Invite sent {formatDate(member.inviteSentAt ?? null)}</span>
								{:else}
									{formatDate(member.lastLogin)}
								{/if}
							</td>
							<!-- <td class="px-4 py-3 text-right font-mono text-green-400">
								{member.xp.toLocaleString()}
							</td>
							<td class="px-4 py-3 text-right font-mono text-amber-400">
								{member.eco.toLocaleString()}
							</td> -->
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Onboarding Details Modal -->
<OnboardingDetails
	isOpen={showOnboardingModal}
	member={selectedMember}
	onClose={closeOnboardingDetails}
/>
