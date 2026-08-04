import { describe, it, expect } from 'vitest';
import {
	buildReactivationApprovedTemplate,
	buildReactivationRejectedTemplate,
	buildReactivationNeedsReviewTemplate,
	buildTimerWarningTemplate
} from './membership-emails';

const APP_URL = 'https://os.ecohubs.community';

describe('approved', () => {
	const t = buildReactivationApprovedTemplate({ recipientName: 'Ada', appUrl: APP_URL });

	it('greets the member and links them straight back in', () => {
		expect(t.body).toContain('Hi Ada,');
		expect(t.body).toContain(APP_URL);
	});

	it('says the access is already restored, not pending', () => {
		expect(t.body).toContain('already restored');
	});

	it('sets no expectation of catching up', () => {
		expect(t.body).toContain('no catch-up expected');
	});
});

describe('rejected', () => {
	const t = buildReactivationRejectedTemplate({
		recipientName: 'Ada',
		canReapplyOn: '1 September 2026'
	});

	// The decision the whole flow turns on: a refused member is told the outcome
	// and nothing else. Leaking counts or reasons would expose voters and turn a
	// confidential ballot into a public judgement of someone.
	it('reveals no vote counts', () => {
		expect(t.body).not.toMatch(/\d+\s*(vote|votes|for|against)/i);
	});

	it('names no voters and quotes no reasons', () => {
		expect(t.body.toLowerCase()).not.toContain('voted against');
		expect(t.body.toLowerCase()).not.toContain('reason given');
		expect(t.body.toLowerCase()).not.toContain('feedback');
	});

	it('is clear the outcome is a no', () => {
		expect(t.body).toContain("wasn't approved");
		expect(t.body).toContain('stays on standby');
	});

	it('tells them when they may ask again, so the door is visibly open', () => {
		expect(t.body).toContain('1 September 2026');
		expect(t.body).toContain("isn't a permanent door closing");
	});

	it('offers a human to talk to', () => {
		expect(t.body).toContain('steward');
		expect(t.body).toContain('reply to this email');
	});

	it('does not say "rejected" at them', () => {
		// The word appears in our data model; it should not appear in the message.
		expect(t.subject.toLowerCase()).not.toContain('rejected');
		expect(t.body.toLowerCase()).not.toContain('rejected');
	});
});

describe('needs review', () => {
	const t = buildReactivationNeedsReviewTemplate({ recipientName: 'Ada' });

	it('explains a steward is picking it up', () => {
		expect(t.body).toContain('steward');
		expect(t.body).toContain('nothing you need to do');
	});

	it('does not imply the request failed', () => {
		expect(t.body.toLowerCase()).not.toContain("wasn't approved");
		expect(t.body.toLowerCase()).not.toContain('declined');
	});
});

describe('timer warning', () => {
	const inactive = buildTimerWarningTemplate({
		recipientName: 'Ada',
		daysRemaining: 14,
		toStatus: 'standby',
		isStandbyCycle: false,
		appUrl: APP_URL
	});

	it('leads with how easily it is undone', () => {
		expect(inactive.body).toContain('resets it');
		expect(inactive.body).toContain('voting on a proposal');
	});

	it('never threatens automatic removal, because nothing is automatic', () => {
		expect(inactive.body.toLowerCase()).not.toContain('will be removed');
		expect(inactive.body.toLowerCase()).not.toContain('automatically');
		expect(inactive.body).toContain('a steward takes a look before anything changes');
	});

	it('reads as a heads-up rather than a final notice', () => {
		expect(inactive.body).toContain('heads-up rather than a deadline');
		expect(inactive.subject.toLowerCase()).not.toContain('warning');
		expect(inactive.subject.toLowerCase()).not.toContain('final');
	});

	it('offers a way out that is not just participating harder', () => {
		expect(inactive.body).toContain("if now isn't the right time");
	});

	it('pluralises the remaining days', () => {
		const one = buildTimerWarningTemplate({
			recipientName: 'Ada',
			daysRemaining: 1,
			toStatus: 'standby',
			isStandbyCycle: false,
			appUrl: APP_URL
		});
		expect(one.body).toContain('1 day');
		expect(one.body).not.toContain('1 days');
		expect(inactive.body).toContain('14 days');
	});

	it('speaks differently to someone already on standby', () => {
		const standby = buildTimerWarningTemplate({
			recipientName: 'Ada',
			daysRemaining: 14,
			toStatus: 'exited',
			isStandbyCycle: true,
			appUrl: APP_URL
		});
		// They are not neglecting anything — they chose to pause — so the
		// "we haven't seen you" framing would be wrong.
		expect(standby.body).not.toContain("haven't seen you");
		expect(standby.body).toContain('/standby');
		expect(standby.body).toContain('stay paused');
	});
});

describe('all templates', () => {
	const all = [
		buildReactivationApprovedTemplate({ recipientName: 'Ada', appUrl: APP_URL }),
		buildReactivationRejectedTemplate({ recipientName: 'Ada', canReapplyOn: '1 September 2026' }),
		buildReactivationNeedsReviewTemplate({ recipientName: 'Ada' }),
		buildTimerWarningTemplate({
			recipientName: 'Ada',
			daysRemaining: 14,
			toStatus: 'standby',
			isStandbyCycle: false,
			appUrl: APP_URL
		})
	];

	it('have a subject and a body', () => {
		for (const t of all) {
			expect(t.subject.length).toBeGreaterThan(0);
			expect(t.body.length).toBeGreaterThan(0);
		}
	});

	it('address the member by name', () => {
		for (const t of all) expect(t.body).toContain('Hi Ada,');
	});

	it('leave no unfilled placeholders', () => {
		for (const t of all) {
			expect(t.body).not.toMatch(/\$\{/);
			expect(t.body).not.toMatch(/\[[A-Za-z ]+\]/);
		}
	});

	it('sign off as the community rather than an individual', () => {
		for (const t of all) expect(t.body).toContain('The EcoHubs community');
	});
});
