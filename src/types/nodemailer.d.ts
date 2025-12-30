declare module 'nodemailer' {
	export interface Transporter {
		sendMail(options: unknown): Promise<unknown>;
		verify(): Promise<void>;
	}
	const nodemailer: unknown;
	export default nodemailer;
}
