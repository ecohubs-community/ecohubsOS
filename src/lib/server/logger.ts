import pino from 'pino';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

// Create logger with environment-appropriate configuration
export const logger = pino({
	level: dev ? 'debug' : 'info',
	transport: dev
		? {
				targets: [
					{
						target: 'pino-pretty',
						level: 'debug',
						options: {
							colorize: true,
							translateTime: 'HH:MM:ss',
							ignore: 'pid,hostname',
							destination: 1
						}
					},
					{
						target: 'pino/file',
						level: 'debug',
						options: {
							destination: (env.LOG_FILE?.trim() || 'logs/ecohubsOS.log') as string,
							mkdir: true
						}
					}
				]
			}
		: {
				targets: [
					{
						target: 'pino/file',
						level: 'info',
						options: { destination: 1 }
					},
					{
						target: 'pino/file',
						level: 'info',
						options: {
							destination: (env.LOG_FILE?.trim() || 'logs/ecohubsOS.log') as string,
							mkdir: true
						}
					}
				]
			},
	// Add base fields to all logs
	base: {
		app: 'ecohubsOS'
	},
	// Redact sensitive fields
	redact: {
		paths: ['password', 'token', 'apiKey', 'secret', 'authorization', '*.password', '*.token'],
		remove: true
	}
});

// Create child loggers for different modules
export const authLogger = logger.child({ module: 'auth' });
export const apiLogger = logger.child({ module: 'api' });
export const dbLogger = logger.child({ module: 'db' });
export const emailLogger = logger.child({ module: 'email' });
export const walletLogger = logger.child({ module: 'wallet' });
export const safeLogger = logger.child({ module: 'safe' });
export const discordLogger = logger.child({ module: 'discord' });
export const flarumLogger = logger.child({ module: 'flarum' });
export const ghostLogger = logger.child({ module: 'ghost' });
export const offcoinLogger = logger.child({ module: 'offcoin' });
export const authentikLogger = logger.child({ module: 'authentik' });
export const onboardingLogger = logger.child({ module: 'onboarding' });
export const puckstackLogger = logger.child({ module: 'puckstack' });
export const listmonkLogger = logger.child({ module: 'listmonk' });
export const votingLogger = logger.child({ module: 'voting' });
