<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '@iconify/svelte';

	interface LogEntry {
		level: number;
		time: number;
		pid: number;
		hostname: string;
		module?: string;
		msg: string;
		[key: string]: any;
	}

	let logs: LogEntry[] = $state([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		await fetchLogs();
	});

	async function fetchLogs() {
		isLoading = true;
		error = null;
		try {
			const res = await fetch('/api/admin/logs');
			if (!res.ok) {
				if (res.status === 403) throw new Error('Access Denied: Admins only');
				throw new Error('Failed to fetch logs');
			}
			const data = await res.json();
			logs = data.logs;
		} catch (e) {
			console.error(e);
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			isLoading = false;
		}
	}

	function getLevelLabel(level: number) {
		if (level >= 60) return 'FATAL';
		if (level >= 50) return 'ERROR';
		if (level >= 40) return 'WARN';
		if (level >= 30) return 'INFO';
		if (level >= 20) return 'DEBUG';
		return 'TRACE';
	}

	function getLevelColor(level: number) {
		if (level >= 50) return 'text-red-400 bg-red-400/10 border-red-400/20';
		if (level >= 40) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
		if (level >= 30) return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
		return 'text-slate-400 bg-slate-400/10 border-slate-400/20';
	}

	function formatDate(timestamp: number) {
		return new Date(timestamp).toLocaleString();
	}
</script>

<div class="text-solar-50 relative flex h-full min-h-full flex-col overflow-hidden bg-solar-900/50">
	{#if isLoading && logs.length === 0}
		<div class="text-solar-300 flex flex-1 items-center justify-center p-8">
			<Icon icon="svg-spinners:90-ring-with-bg" class="mr-2 h-6 w-6" />
			Loading logs...
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center p-8 text-red-400">
			<Icon icon="tabler:alert-triangle" class="mr-2 h-6 w-6" />
			{error}
		</div>
	{:else}
		<div class="flex h-full flex-col" transition:fade>
			<div class="shrink-0 p-6 pb-2">
				<div class="flex items-center justify-between">
					<h2 class="flex items-center gap-2 text-xl font-bold">
						<Icon icon="tabler:file-text" class="text-solar-400 h-6 w-6" />
						System Logs
						<span
							class="text-solar-400/60 ml-2 rounded-full border border-white/5 bg-solar-900/40 px-2 py-0.5 text-sm font-normal"
						>
							{logs.length} Entries
						</span>
					</h2>
					<button
						onclick={fetchLogs}
						class="text-solar-300 hover:text-solar-100 flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors hover:bg-white/5"
						disabled={isLoading}
					>
						<Icon icon="tabler:refresh" class={isLoading ? 'animate-spin' : ''} />
						Refresh
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-auto p-6 pt-2">
				<table class="w-full border-collapse text-left font-mono text-sm">
					<thead class="sticky top-0 bg-solar-900/90 backdrop-blur">
						<tr class="text-solar-400/80 border-b border-white/10">
							<th class="w-48 px-4 py-3 font-medium">Time</th>
							<th class="w-24 px-4 py-3 font-medium">Level</th>
							<th class="w-32 px-4 py-3 font-medium">Module</th>
							<th class="px-4 py-3 font-medium">Message</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-white/5">
						{#each logs as log}
							<tr class="group transition-colors hover:bg-white/5">
								<td class="text-solar-400/60 px-4 py-2 text-xs whitespace-nowrap">
									{formatDate(log.time)}
								</td>
								<td class="px-4 py-2">
									<span
										class={`rounded px-1.5 py-0.5 text-[10px] font-bold ${getLevelColor(log.level)}`}
									>
										{getLevelLabel(log.level)}
									</span>
								</td>
								<td class="text-solar-300 px-4 py-2 text-xs">
									{log.module || '-'}
								</td>
								<td class="text-solar-100 px-4 py-2 break-all">
									{log.msg}
									{#if Object.keys(log).filter((k) => !['level', 'time', 'pid', 'hostname', 'module', 'msg', 'v'].includes(k)).length > 0}
										<div class="text-solar-400/50 mt-1 text-xs">
											{JSON.stringify(
												Object.fromEntries(
													Object.entries(log).filter(
														([k]) =>
															!['level', 'time', 'pid', 'hostname', 'module', 'msg', 'v'].includes(
																k
															)
													)
												)
											)}
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
