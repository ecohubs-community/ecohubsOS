<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';
	import OnboardingDetails from './OnboardingDetails.svelte';

	type OnboardingFilter = 'All' | 'Not Started' | 'In Progress' | 'Complete';

	interface Member {
		id: string;
		name: string;
		email: string;
		groups: string[];
		lastLogin: string | null;
		onboardingStatus: 'Complete' | 'In Progress' | 'Not Started';
		onboardingProgress: string;
		onboardingStartedAt: string | null;
		onboardingCompletedAt: string | null;
		xp: number;
		eco: number;
		avatarUrl: string | null;
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

	const FILTERS: OnboardingFilter[] = ['All', 'Not Started', 'In Progress', 'Complete'];

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
								<div class="flex items-center gap-2">
									<span
										class={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(member.onboardingStatus)}`}
									>
										{member.onboardingStatus}
									</span>
									{#if member.onboardingProgress}
										<button
											class="text-solar-400 transition-colors hover:text-white"
											onclick={() => openOnboardingDetails(member)}
											title="View Details"
										>
											<Icon icon="tabler:info-circle" class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</td>
							<td class="text-solar-300 px-4 py-3">
								{formatDate(member.lastLogin)}
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
