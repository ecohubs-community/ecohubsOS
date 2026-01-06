import pino from 'pino';
import { dev } from '$app/environment';

// Create logger with environment-appropriate configuration
export const logger = pino({
	level: dev ? 'debug' : 'info',
	transport: dev
		? {
				target: 'pino-pretty',
				options: {
					colorize: true,
					translateTime: 'HH:MM:ss',
					ignore: 'pid,hostname'
				}
			}
		: undefined, // Use default JSON output in production
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
