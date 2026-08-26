import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProposalDetail from './ProposalDetail.svelte';
import type { ProposalDetail as ProposalDetailType } from './types';

function proposal(overrides: Partial<ProposalDetailType> = {}): ProposalDetailType {
	const now = new Date().toISOString();
	return {
		id: 'p1',
		type: 'operational',
		title: 'Move the community call to Thursdays',
		body: 'Attendance has been dropping on Tuesdays.',
		motion: null,
		tags: [],
		choiceSetKey: 'default',
		choices: ['Yes', 'No', 'Abstain'],
		threshold: 'majority',
		status: 'active',
		result: null,
		authorUserId: 'u1',
		createdAt: now,
		voteOpensAt: now,
		voteClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
		ratificationEndsAt: null,
		linkedApplicationId: null,
		linkedBlogDraftId: null,
		votesByChoice: {},
		votesTotal: 0,
		userHasVoted: false,
		withdrawalReason: null,
		withdrawnAt: null,
		voters: [],
		...overrides
	} as ProposalDetailType;
}

const mount = (p: ProposalDetailType) =>
	render(ProposalDetail, { proposal: p, onBack: () => {}, onVoted: () => {} });

describe('ProposalDetail — the motion', () => {
	it('shows no Motion section when the proposal carries none', async () => {
		mount(proposal());
		await expect.element(page.getByText('Attendance has been dropping')).toBeInTheDocument();
		expect(document.querySelector('.motion-section')).toBeNull();
	});

	it('renders the motion as Markdown, set apart from the description', async () => {
		mount(proposal({ motion: 'The call **moves** to Thursdays at 18:00 CET.' }));

		const section = document.querySelector('.motion-section');
		expect(section).not.toBeNull();
		expect(section!.querySelector('strong')?.textContent).toBe('moves');
		// Distinct container from the description, not more prose inside it.
		expect(document.querySelector('.body-section')!.contains(section!)).toBe(false);
	});

	it('says plainly that the motion is what is being voted on', async () => {
		mount(proposal({ motion: 'We resolve that…' }));
		await expect.element(page.getByText(/exact wording being voted on/i)).toBeInTheDocument();
	});
});
