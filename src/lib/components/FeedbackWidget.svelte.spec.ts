import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FeedbackWidget from './FeedbackWidget.svelte';
import { os } from '$lib/os.svelte';

/**
 * The widget loads the member's own feedback the first time it opens. None of
 * these cases care about that list, so it is served from a stub rather than
 * left to fail against a dev server that isn't running the API.
 */
function stubFeedbackList(feedback: unknown[] = []) {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ feedback }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
		)
	);
}

// Exact matching keeps the message field apart from the floating trigger,
// whose accessible name ("Send feedback") contains the label text.
const titleField = () => page.getByLabelText('Title', { exact: true });
const messageField = () => page.getByLabelText('Feedback', { exact: true });

const PREFILL = {
	subject: 'Access request: Members',
	message: "I'd like access to Members.\n\nWhat I'd like to contribute:\n"
};

afterEach(() => {
	// `os` is a module-level singleton shared by every case in this file.
	os.closeFeedback();
	vi.unstubAllGlobals();
});

describe('FeedbackWidget prefill', () => {
	it('fills an empty form from the prefill', async () => {
		stubFeedbackList();
		render(FeedbackWidget);

		os.openFeedback(PREFILL);

		await expect.element(titleField()).toHaveValue(PREFILL.subject);
		await expect.element(messageField()).toHaveValue(PREFILL.message);
	});

	it('leaves the fields empty when opened without a prefill', async () => {
		stubFeedbackList();
		render(FeedbackWidget);

		os.openFeedback();

		await expect.element(titleField()).toHaveValue('');
		await expect.element(messageField()).toHaveValue('');
	});

	it('keeps text the member has already written', async () => {
		stubFeedbackList();
		render(FeedbackWidget);

		os.openFeedback();
		await titleField().fill('My own words');

		os.openFeedback(PREFILL);

		await expect.element(titleField()).toHaveValue('My own words');
		// The message was still untouched, so that half of the prefill lands.
		await expect.element(messageField()).toHaveValue(PREFILL.message);
	});

	it('truncates a prefill to the field limits', async () => {
		stubFeedbackList();
		render(FeedbackWidget);

		os.openFeedback({ subject: 'x'.repeat(150), message: 'y'.repeat(2500) });

		await expect.element(titleField()).toHaveValue('x'.repeat(100));
		await expect.element(messageField()).toHaveValue('y'.repeat(2000));
	});

	it('shows the form when the prefill arrives while the list is up', async () => {
		stubFeedbackList([
			{
				id: '1',
				title: 'Earlier note',
				message: 'Something else',
				createdAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		render(FeedbackWidget);

		os.openFeedback();
		await page.getByRole('button', { name: 'My feedback' }).click();
		await expect.element(page.getByText('Earlier note')).toBeInTheDocument();

		os.openFeedback(PREFILL);

		await expect.element(titleField()).toHaveValue(PREFILL.subject);
	});
});
