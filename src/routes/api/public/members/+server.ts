import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { isNotNull } from 'drizzle-orm';
import { getOffcoinClient, memberAlias } from '$lib/server/offcoin';
import { isAtLeastRole, parseGroupsJson, resolveRole } from '$lib/policy';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ request }) => {
	// API key authentication
	const apiKey = request.headers.get('x-api-key');
	const expectedApiKey = env.MEMBERS_API_KEY;

	if (!expectedApiKey) {
		console.error('MEMBERS_API_KEY not configured');
		error(500, 'Server configuration error');
	}

	if (!apiKey || apiKey !== expectedApiKey) {
		error(401, 'Invalid or missing API key');
	}

	try {
		// Fetch users with onboarding started (In Progress or Complete)
		const members = await db.query.user.findMany({
			where: isNotNull(user.onboardingStartedAt)
		});

		const appUrl = env.VITE_PUBLIC_APP_URL || 'https://os.ecohubs.community';
		const offcoin = getOffcoinClient();

		// Decide who is published *before* asking Offcoin about them.
		//
		// Only members, stewards and admins appear. Trial members are people still
		// finding their footing — the public list is a roster of the community,
		// not of everyone who has an account. Exited members are excluded for the
		// same reason, more strongly.
		//
		// Filtering first matters: each published member costs three Offcoin
		// round-trips, and trial accounts are the larger group. Filtering after
		// the fetch would spend most of those calls on rows about to be discarded.
		const published = members.filter((member) => {
			if (member.membershipStatus === 'exited') return false;
			return isAtLeastRole(resolveRole(parseGroupsJson(member.groups)), 'member');
		});

		// Fetch offcoin data for all published members in parallel
		const offcoinResults = await Promise.allSettled(
			published.map(async (member) => {
				if (!member.puckstackUserId) return null;
				const alias = memberAlias(member.puckstackUserId);
				const [memberData, xpData, balanceData] = await Promise.all([
					offcoin.members.get(alias),
					offcoin.members.getXp(alias),
					offcoin.members.getBalance(alias)
				]);
				return {
					userId: member.id,
					name: memberData.name,
					xp: xpData.xp,
					level: xpData.level,
					eco: balanceData.balance
				};
			})
		);

		// Build offcoin lookup map
		const offcoinMap = new Map<string, { name: string; xp: number; level: number; eco: number }>();
		for (const result of offcoinResults) {
			if (result.status === 'fulfilled' && result.value) {
				offcoinMap.set(result.value.userId, {
					name: result.value.name,
					xp: result.value.xp,
					level: result.value.level,
					eco: result.value.eco
				});
			}
		}

		// Build response
		const response = published.map((member) => {
			const oc = offcoinMap.get(member.id);
			// Fall back to the stored snapshot when Offcoin is unreachable, so a
			// transient outage shows a stale figure rather than zeroing everyone.
			const xp = oc?.xp ?? member.offcoinXp ?? 0;
			const level = oc?.level ?? member.offcoinLevel ?? 0;
			const eco = oc?.eco ?? 0;
			const role = resolveRole(parseGroupsJson(member.groups));

			// Build display name with priority logic
			let displayName: string;
			if (member.displayName && oc?.name) {
				displayName = `${member.displayName} / ${oc.name}`;
			} else if (member.displayName) {
				displayName = member.displayName;
			} else if (oc?.name) {
				displayName = oc.name;
			} else {
				displayName = member.name;
			}

			const showOnWebsite = member.showOnWebsite ?? true;

			if (showOnWebsite) {
				return {
					displayName,
					avatarUrl: member.avatar ? `${appUrl}${member.avatar}` : null,
					bio: member.bio ?? null,
					languages: member.languages ?? null,
					location: member.location ?? null,
					contribution: member.contribution ?? null,
					xp,
					level,
					eco,
					role,
					showOnWebsite: true
				};
			} else {
				return {
					displayName,
					avatarUrl: null,
					bio: null,
					languages: null,
					location: null,
					contribution: null,
					xp,
					level,
					eco,
					role,
					showOnWebsite: false
				};
			}
		});

		// Sort by XP descending
		response.sort((a, b) => b.xp - a.xp);

		return json({ members: response });
	} catch (err) {
		console.error('Error fetching public members:', err);
		error(500, 'Failed to fetch members');
	}
};
