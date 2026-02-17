import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { db } from './db';
import * as schema from './db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { authentikLogger } from './logger';
import { dev } from '$app/environment';

if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification
		}
	}),

	emailAndPassword: {
		enabled: false // Users are added manually in Authentik, no registration
	},

	plugins: [
		genericOAuth({
			config: [
				{
					providerId: 'authentik',
					clientId: env.AUTHENTIK_CLIENT_ID!,
					clientSecret: env.AUTHENTIK_CLIENT_SECRET!,
					discoveryUrl: `${env.AUTHENTIK_ISSUER_URL}/.well-known/openid-configuration`,
					scopes: ['openid', 'profile', 'email', 'groups'],
					pkce: true,
					// Map OIDC claims to user fields
					mapProfileToUser: async (profile) => {
						authentikLogger.debug({ profile }, 'Mapping Authentik profile to user');

						// Side-effect: Force update existing user's groups/roles
						// This ensures that even if better-auth doesn't update the user record for existing users,
						// we manually keep the groups in sync.
						try {
							const groups = JSON.stringify(profile.groups || []);
							const roles = JSON.stringify(profile.roles || []);

							// We use email to find the user because we don't have the user ID yet in this context
							// and better-auth checks by email.
							if (profile.email) {
								await db.update(schema.user)
									.set({
										groups,
										roles,
										updatedAt: new Date()
									})
									.where(eq(schema.user.email, profile.email)); // Use eq from drizzle-orm directly

								authentikLogger.info({ email: profile.email, groups }, 'Updated user groups from Authentik profile (side-effect)');
							}
						} catch (e) {
							authentikLogger.error({ err: e, email: profile.email }, 'Failed to update user groups side-effect');
						}

						return {
							name: profile.name || profile.preferred_username || 'Unknown',
							email: profile.email,
							emailVerified: profile.email_verified ?? false,
							image: profile.picture || null,
							authentikId: profile.sub,
							groups: JSON.stringify(profile.groups || []),
							roles: JSON.stringify(profile.roles || [])
						};
					}
				}
			]
		})
	],

	session: {
		cookieCache: {
			enabled: true,
			maxAge: 60 * 60 * 24 * 7 // 7 days
		},
		cookie: {
			httpOnly: true,
			secure: !dev, // Require HTTPS in production
			sameSite: 'lax' // 'lax' allows OAuth redirects while protecting against CSRF
		}
	},

	trustedOrigins: [env.VITE_PUBLIC_APP_URL || 'http://localhost:5173']
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
