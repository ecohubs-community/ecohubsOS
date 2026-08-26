import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProposalForm from './ProposalForm.svelte';

function mount(canAuthorGovernance = true) {
	return render(ProposalForm, {
		availableTags: [],
		canAuthorGovernance,
		onCancel: () => {},
		onCreated: () => {}
	});
}

describe('ProposalForm — the optional motion', () => {
	it('starts collapsed, so the default proposal is description-only', async () => {
		mount();
		await expect.element(page.getByRole('button', { name: /Motion/ })).toBeInTheDocument();
		expect(document.querySelector('#proposal-motion')).toBeNull();
	});

	it('expands to a Markdown editor with a Preview tab, like the description', async () => {
		mount();
		await page.getByRole('button', { name: /Motion/ }).click();

		const pane = document.querySelector('#proposal-motion');
		expect(pane).not.toBeNull();
		// Both editors offer Write/Preview; expanding the motion adds a second pair.
		expect(page.getByRole('button', { name: 'Preview' }).elements()).toHaveLength(2);
		expect(page.getByRole('button', { name: 'Write' }).elements()).toHaveLength(2);
	});

	it('renders typed Markdown in the motion preview', async () => {
		mount();
		await page.getByRole('button', { name: /Motion/ }).click();

		const textarea = document
			.querySelector('#proposal-motion')!
			.querySelector('textarea') as HTMLTextAreaElement;
		await page.elementLocator(textarea).fill('We resolve **that**');

		const previews = page.getByRole('button', { name: 'Preview' }).elements();
		await page.elementLocator(previews[1]).click();

		const rendered = document.querySelector('#proposal-motion')!.querySelector('strong');
		expect(rendered?.textContent).toBe('that');
	});

	it('keeps the motion when collapsed, and says so', async () => {
		mount();
		const toggle = page.getByRole('button', { name: /Motion/ });
		await toggle.click();

		const textarea = document
			.querySelector('#proposal-motion')!
			.querySelector('textarea') as HTMLTextAreaElement;
		await page.elementLocator(textarea).fill('We resolve that…');

		await toggle.click();
		expect(document.querySelector('#proposal-motion')).toBeNull();
		// Collapsing must not hide that wording exists.
		await expect.element(page.getByText('written')).toBeInTheDocument();

		await toggle.click();
		const reopened = document
			.querySelector('#proposal-motion')!
			.querySelector('textarea') as HTMLTextAreaElement;
		expect(reopened.value).toBe('We resolve that…');
	});
});

describe('ProposalForm — the type gate', () => {
	it('disables strategic and constitutional for a member', async () => {
		mount(false);
		const select = document.querySelector('#proposal-type') as HTMLSelectElement;
		const disabled = [...select.options].filter((o) => o.disabled).map((o) => o.value);
		expect(disabled).toEqual(['strategic', 'constitutional']);
	});

	it('leaves every type open to a steward', async () => {
		mount(true);
		const select = document.querySelector('#proposal-type') as HTMLSelectElement;
		expect([...select.options].filter((o) => o.disabled)).toHaveLength(0);
	});
});
