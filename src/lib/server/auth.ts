import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { db } from './db';
import * as schema from './db/schema';
import { env } from '$env/dynamic/private';
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
					mapProfileToUser: (profile) => {
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

	trustedOrigins: [env.PUBLIC_APP_URL || 'http://localhost:5173']
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
