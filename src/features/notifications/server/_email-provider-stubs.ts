/**
 * Stubs for @visulima/email/providers/* to avoid bundling Node.js-only
 * modules (node:fs, node:stream, etc.) that break Cloudflare Workers
 * deployment validation. The project uses Cloudflare Email Workers
 * (send_email binding) for actual delivery, so these provider
 * implementations are never invoked at runtime.
 */

export function mailgunProvider(_opts: unknown) {
	return {
		async _throw() {
			throw new Error(
				"Mailgun provider is not available in Cloudflare Workers. Use the Cloudflare Email Workers binding instead.",
			);
		},
		sendEmail: () => ({ _throw: () => ({}) }) as never,
	};
}

export function postmarkProvider(_opts: unknown) {
	return {
		async _throw() {
			throw new Error(
				"Postmark provider is not available in Cloudflare Workers. Use the Cloudflare Email Workers binding instead.",
			);
		},
		sendEmail: () => ({ _throw: () => ({}) }) as never,
	};
}

export function resendProvider(_opts: unknown) {
	return {
		async _throw() {
			throw new Error(
				"Resend provider is not available in Cloudflare Workers. Use the Cloudflare Email Workers binding instead.",
			);
		},
		sendEmail: () => ({ _throw: () => ({}) }) as never,
	};
}

export function sendGridProvider(_opts: unknown) {
	return {
		async _throw() {
			throw new Error(
				"SendGrid provider is not available in Cloudflare Workers. Use the Cloudflare Email Workers binding instead.",
			);
		},
		sendEmail: () => ({ _throw: () => ({}) }) as never,
	};
}

export function smtpProvider(_opts: unknown) {
	return {
		async _throw() {
			throw new Error(
				"SMTP provider is not available in Cloudflare Workers. Use the Cloudflare Email Workers binding instead.",
			);
		},
		sendEmail: () => ({ _throw: () => ({}) }) as never,
	};
}
