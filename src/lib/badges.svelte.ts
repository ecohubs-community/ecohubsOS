// Badge counts for apps with pending items

interface BadgeCounts {
	'membership-manager': number;
	'blog-manager': number;
}

function createBadgesStore() {
	let counts = $state<BadgeCounts>({
		'membership-manager': 0,
		'blog-manager': 0
	});

	let isLoading = $state(false);

	async function refresh() {
		isLoading = true;

		try {
			// Fetch pending membership applications
			const applicationsResponse = await fetch('/api/applications');
			if (applicationsResponse.ok) {
				const data = await applicationsResponse.json();
				// Count applications that are pending (no proposal created yet)
				counts['membership-manager'] = data.applications.filter(
					(app: { status: string }) => app.status === 'pending'
				).length;
			}
		} catch (err) {
			console.error('Failed to fetch membership applications:', err);
		}

		try {
			// Fetch blog drafts without proposals
			const draftsResponse = await fetch('/api/blog/drafts');
			if (draftsResponse.ok) {
				const data = await draftsResponse.json();
				// Count drafts that have no proposal
				counts['blog-manager'] = data.drafts.filter(
					(draft: { proposalStatus: string }) => draft.proposalStatus === 'none'
				).length;
			}
		} catch (err) {
			console.error('Failed to fetch blog drafts:', err);
		}

		isLoading = false;
	}

	function getCount(appId: string): number {
		if (appId === 'membership-manager') {
			return counts['membership-manager'];
		}
		if (appId === 'blog-manager') {
			return counts['blog-manager'];
		}
		return 0;
	}

	return {
		get counts() {
			return counts;
		},
		get isLoading() {
			return isLoading;
		},
		refresh,
		getCount
	};
}

export const badges = createBadgesStore();
