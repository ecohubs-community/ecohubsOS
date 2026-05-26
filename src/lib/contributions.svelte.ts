// Reactive store for the "Immediate Contributions" desktop card.
//
// Holds: per-user completion state for static items (persisted via
// /api/contributions/progress), the live Puckstack counts (via the
// /api/puckstack/contributions proxy), and the active-unvoted proposal
// count (reusing the existing voting list endpoint). Mirrors the shape of
// offcoin.svelte.ts.

interface ContributionCounts {
	unreadNotifications: number;
	tasksNeedingReview: number;
	openTasks: number;
}

class ContributionsState {
	completed = $state<Record<string, string>>({});
	counts = $state<ContributionCounts>({
		unreadNotifications: 0,
		tasksNeedingReview: 0,
		openTasks: 0
	});
	isMember = $state(false);
	votingCount = $state(0);
	countsLoaded = $state(false);

	private progressLoaded = false;
	private countsRequested = false;

	isDone(id: string): boolean {
		return !!this.completed[id];
	}

	async loadProgress(): Promise<void> {
		if (this.progressLoaded) return;
		this.progressLoaded = true;
		try {
			const res = await fetch('/api/contributions/progress');
			if (res.ok) {
				const data = await res.json();
				this.completed = (data.progress as Record<string, string>) ?? {};
			}
		} catch {
			// non-critical
		}
	}

	markDone(id: string): void {
		if (this.completed[id]) return;
		const ts = new Date().toISOString();
		this.completed = { ...this.completed, [id]: ts };
		// Fire-and-forget persistence (mirrors onboarding sync).
		fetch('/api/contributions/progress', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ completedItems: { [id]: ts } })
		}).catch(() => {
			/* localStorage-less; server is source of truth, retried on next mark */
		});
	}

	/** Remove a completion mark. Server has no delete op, so we replace the
	 * whole map via `reset: true`. */
	markUndone(id: string): void {
		if (!this.completed[id]) return;
		const next = { ...this.completed };
		delete next[id];
		this.completed = next;
		fetch('/api/contributions/progress', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ completedItems: next, reset: true })
		}).catch(() => {
			/* server is source of truth; retried on next toggle */
		});
	}

	/** Toggle a contribution item's completion state. */
	toggle(id: string): void {
		if (this.completed[id]) {
			this.markUndone(id);
		} else {
			this.markDone(id);
		}
	}

	/** Puckstack-backed counts. Safe to call repeatedly; only fetches once. */
	async loadCounts(): Promise<void> {
		if (this.countsRequested) return;
		this.countsRequested = true;
		try {
			const res = await fetch('/api/puckstack/contributions');
			if (res.ok) {
				const data = await res.json();
				this.counts = data.counts ?? this.counts;
				this.isMember = !!data.isMember;
			}
		} catch {
			// graceful: leave zeros, isMember false
		} finally {
			this.countsLoaded = true;
		}
	}

	/** Count of active proposals the user hasn't voted on yet. */
	async loadVotingCount(): Promise<void> {
		try {
			const res = await fetch('/api/proposals?status=active&unvoted=1');
			if (res.ok) {
				const data = await res.json();
				this.votingCount = Array.isArray(data.proposals) ? data.proposals.length : 0;
			}
		} catch {
			// non-critical
		}
	}

	/**
	 * Force a re-fetch of all contribution data. Clears the one-time load
	 * guards so loadProgress/loadCounts actually hit the network again.
	 */
	async refresh(): Promise<void> {
		this.progressLoaded = false;
		this.countsRequested = false;
		await Promise.all([this.loadProgress(), this.loadCounts(), this.loadVotingCount()]);
	}
}

export const contributions = new ContributionsState();
