// Badge counts for apps with pending items

interface BadgeCounts {
	'membership-manager': number;
	'blog-manager': number;
	voting: number;
	'feedback-admin': number;
	'admin-logs': number;
}

function createBadgesStore() {
	let counts = $state<BadgeCounts>({
		'membership-manager': 0,
		'blog-manager': 0,
		voting: 0,
		'feedback-admin': 0,
		'admin-logs': 0
	});

	let isLoading = $state(false);

	async function refresh() {
		isLoading = true;

		try {
			// Fetch membership applications (enriched with voting data)
			const applicationsResponse = await fetch('/api/applications');
			if (applicationsResponse.ok) {
				const data = await applicationsResponse.json();
				// Count applications that need attention:
				// - Pending (no proposal yet)
				// - Active voting (vote in progress)
				// - Approved but confirmation email not sent
				counts['membership-manager'] = data.applications.filter(
					(app: {
						status: string;
						votingStatus: string;
						votingResult: string | null;
						confirmationEmailSentAt: string | null;
					}) =>
						app.status === 'pending' ||
						app.votingStatus === 'active' ||
						(app.votingResult === 'approved' && !app.confirmationEmailSentAt)
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

		try {
			// Active proposals the user hasn't voted on yet
			const votingResponse = await fetch('/api/proposals?status=active&unvoted=1');
			if (votingResponse.ok) {
				const data = await votingResponse.json();
				counts.voting = Array.isArray(data.proposals) ? data.proposals.length : 0;
			}
		} catch (err) {
			console.error('Failed to fetch active proposals:', err);
		}

		try {
			// Unacknowledged member feedback (admin-only; non-admins get 403 → 0)
			const feedbackResponse = await fetch('/api/admin/feedback');
			if (feedbackResponse.ok) {
				const data = await feedbackResponse.json();
				counts['feedback-admin'] = Array.isArray(data.feedback)
					? data.feedback.filter((f: { acknowledgedAt: string | null }) => !f.acknowledgedAt).length
					: 0;
			} else {
				counts['feedback-admin'] = 0;
			}
		} catch (err) {
			console.error('Failed to fetch feedback:', err);
		}

		try {
			// Error/fatal log entries (level >= 50) from the past 7 days.
			// Admin-only → non-admins get 403 → 0.
			const logsResponse = await fetch('/api/admin/logs');
			if (logsResponse.ok) {
				const data = await logsResponse.json();
				const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
				counts['admin-logs'] = Array.isArray(data.logs)
					? data.logs.filter(
							(log: { level: number; time: number }) =>
								log.level >= 50 && log.time >= sevenDaysAgo
						).length
					: 0;
			} else {
				counts['admin-logs'] = 0;
			}
		} catch (err) {
			console.error('Failed to fetch logs:', err);
		}

		isLoading = false;
	}

	function getCount(appId: string): number {
		if (appId === 'membership-manager') return counts['membership-manager'];
		if (appId === 'blog-manager') return counts['blog-manager'];
		if (appId === 'voting') return counts.voting;
		if (appId === 'feedback-admin') return counts['feedback-admin'];
		if (appId === 'admin-logs') return counts['admin-logs'];
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
