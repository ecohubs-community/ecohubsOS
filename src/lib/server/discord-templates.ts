function getFirstName(fullName: string): string {
	return fullName.split(' ')[0] || fullName;
}

interface NewApplicationData {
	fullName: string;
}

interface ProposalCreatedData {
	fullName: string;
	location: string;
	snapshotLink: string;
}

interface ConfirmationSentData {
	fullName: string;
	location: string;
}

interface RejectionSentData {
	fullName: string;
	snapshotLink: string;
}

export function newApplicationMessage(data: NewApplicationData): string {
	const firstName = getFirstName(data.fullName);
	return `📋 A new membership application from **${firstName}** arrived! Log into os.ecohubs.community to create a voting proposal!`;
}

export function proposalCreatedMessage(data: ProposalCreatedData): string {
	const firstName = getFirstName(data.fullName);
	return `🗳️ New membership proposal was created. [Click here](${data.snapshotLink}) to vote for/against **${firstName}** from **${data.location}**. In case you have technical voting issues or questions please let me know here. You can read the full application on https://os.ecohubs.community/`;
}

export function confirmationSentMessage(data: ConfirmationSentData): string {
	const firstName = getFirstName(data.fullName);
	return `🎉 New member joined: **${firstName}** from **${data.location}** — welcome them!`;
}

export function rejectionSentMessage(data: RejectionSentData): string {
	const firstName = getFirstName(data.fullName);
	return `📊 Application was declined — the vote decided against application of **${firstName}**. [Here](${data.snapshotLink}) you can see the voting result`;
}
