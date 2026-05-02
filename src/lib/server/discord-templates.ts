function getFirstName(fullName: string): string {
	return fullName.split(' ')[0] || fullName;
}

interface NewApplicationData {
	fullName: string;
}

interface ProposalTitleData {
	title: string;
}

interface NewProposalData {
	title: string;
	type: string;
	authorName: string;
}

interface ConfirmationSentData {
	fullName: string;
	location: string;
}

interface RejectionSentData {
	fullName: string;
}

export function newApplicationMessage(data: NewApplicationData): string {
	const firstName = getFirstName(data.fullName);
	return `📋🗳️ A new membership application from **${firstName}** arrived. A voting proposal has been opened — head to os.ecohubs.community to vote.`;
}

export function confirmationSentMessage(data: ConfirmationSentData): string {
	const firstName = getFirstName(data.fullName);
	return `🎉 New member joined: **${firstName}** from **${data.location}** — welcome them!`;
}

export function rejectionSentMessage(data: RejectionSentData): string {
	const firstName = getFirstName(data.fullName);
	return `📊 Application was declined — the vote decided against application of **${firstName}**. Open ecohubsOS for the voting record.`;
}

// --- Internal voting system (link-free per spec §6.6) ---

export function newProposalMessage(data: NewProposalData): string {
	return `🗳️ A new **${data.type}** proposal "**${data.title}**" was submitted by ${data.authorName}. Open ecohubsOS to read and vote.`;
}

export function proposalClosedApprovedMessage(data: ProposalTitleData): string {
	return `✅ Proposal "**${data.title}**" passed. Open ecohubsOS to see the result.`;
}

export function proposalClosedRejectedMessage(data: ProposalTitleData): string {
	return `❌ Proposal "**${data.title}**" did not pass. Open ecohubsOS to see the result.`;
}

export function proposalNeedsReviewMessage(data: ProposalTitleData): string {
	return `🔍 Proposal "**${data.title}**" closed with "Needs Review" as the leading outcome. Open ecohubsOS for details.`;
}

export function proposalRatifiedMessage(data: ProposalTitleData): string {
	return `📜 Constitutional proposal "**${data.title}**" has finished its 30-day ratification period and is now in force.`;
}
