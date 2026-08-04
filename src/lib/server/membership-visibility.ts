import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { applications, user as userTable } from '$lib/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { isAdmin } from '$lib/server/authz';

export interface MembershipVisibility {
	/** false for admins — no filtering. true for non-admin members. */
	restricted: boolean;
	/**
	 * ISO-8601 timestamp cutoff. A restricted caller may see only membership
	 * applications / votes whose (linked) application was submitted STRICTLY
	 * AFTER this instant. Anchored to the caller's own most-recent application
	 * or, when they have none, their account creation time. Null only for admins.
	 */
	cutoff: string | null;
	/** Lowercased caller email — also used to exclude the caller's own application. */
	email: string;
}

/**
 * Compute what membership applications / votes a caller is allowed to see.
 *
 * Non-admin members must not see applications or membership votes that happened
 * before their own, nor their own. The anchor ("yours") is the caller's own
 * application (matched by email, latest `submittedAt`); members with no
 * application on record fall back to their account creation time.
 *
 * Callers must have already verified `locals.user` is present.
 */
export async function getMembershipVisibility(
	locals: RequestEvent['locals']
): Promise<MembershipVisibility> {
	// Admins see everything.
	if (isAdmin(locals)) {
		return { restricted: false, cutoff: null, email: '' };
	}

	const u = locals.user!;
	const email = (u.email ?? '').toLowerCase();

	// Anchor to the caller's own most-recent *membership* application.
	//
	// The type filter is load-bearing. A reactivation request creates another
	// `applications` row for the same person; without it, their cutoff would jump
	// forward to the reactivation date and they would silently lose visibility of
	// every application and membership vote between their original join and their
	// return.
	const [own] = await db
		.select({ submittedAt: applications.submittedAt })
		.from(applications)
		.where(sql`lower(${applications.email}) = ${email} and ${applications.type} = 'membership'`)
		.orderBy(desc(applications.submittedAt))
		.limit(1);

	let cutoff = own?.submittedAt ?? null;

	// No application on record → anchor to account creation instead.
	if (!cutoff) {
		const [row] = await db
			.select({ createdAt: userTable.createdAt })
			.from(userTable)
			.where(eq(userTable.id, u.id))
			.limit(1);
		cutoff = row?.createdAt ? row.createdAt.toISOString() : new Date(0).toISOString();
	}

	return { restricted: true, cutoff, email };
}
