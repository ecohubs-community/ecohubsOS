import {
	SMTP_HOST,
	SMTP_PASSWORD,
	SMTP_USER,
	SMTP_SECURE,
	SMTP_PORT,
	EMAIL_FROM,
	EMAIL_FROM_NAME
} from '$env/static/private';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export function getEmailTransporter(): Transporter {
	if (transporter) {
		return transporter;
	}

	const smtpHost = SMTP_HOST || 'localhost';
	const smtpPort = parseInt(SMTP_PORT || '1025');
	const smtpSecure = SMTP_SECURE === 'true';
	const smtpUser = SMTP_USER || '';
	const smtpPassword = SMTP_PASSWORD || '';

	// Determine if we should use secure (SSL/TLS) or STARTTLS
	// Port 465 = SSL/TLS (secure: true)
	// Port 587 = STARTTLS (secure: false, requiresTLS: true)
	// Port 25 = Plain (secure: false)
	const isSecurePort = smtpPort === 465;
	const useSecure = isSecurePort || (smtpSecure && smtpPort !== 587);
	const requireTLS = smtpPort === 587 && !useSecure;

	const nm = nodemailer as unknown as { createTransport: (opts: unknown) => Transporter };
	transporter = nm.createTransport({
		host: smtpHost,
		port: smtpPort,
		secure: useSecure, // true for 465, false for other ports
		requireTLS: requireTLS, // true for 587
		auth:
			smtpUser && smtpPassword
				? {
						user: smtpUser,
						pass: smtpPassword
					}
				: undefined,
		// Connection timeout settings
		connectionTimeout: 10000, // 10 seconds
		socketTimeout: 10000, // 10 seconds
		greetingTimeout: 10000, // 10 seconds
		// TLS options
		tls: {
			// Don't reject unauthorized certificates for localhost/dev servers
			rejectUnauthorized: smtpHost !== 'localhost'
		}
	});

	return transporter as Transporter;
}

export interface SendEmailOptions {
	to: string | string[];
	subject: string;
	text: string;
	html: string;
	replyTo?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
	const transporter = getEmailTransporter();

	const emailFrom = EMAIL_FROM || 'noreply@ecohubs.community';
	const emailFromName = EMAIL_FROM_NAME || 'EcoHubs Community';

	await transporter.sendMail({
		from: `"${emailFromName}" <${emailFrom}>`,
		to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
		subject: options.subject,
		text: options.text,
		html: options.html,
		replyTo: options.replyTo
	});
}

export async function verifyEmailConnection(): Promise<boolean> {
	try {
		const transporter = getEmailTransporter();
		await transporter.verify();
		return true;
	} catch (error) {
		console.error('Email connection verification failed:', error);
		return false;
	}
}
