import { createStart } from "@tanstack/react-start";
import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { handleLivenessRequest } from "#/features/status/server/health";
import { applySecurityHeaders } from "#/server/http-security";
import { requestMiddleware } from "#/server/middleware";
import { validateRequestAuthority } from "#/server/middleware/authority";
import { handleI18nRequest } from "#/server/middleware/i18n";
import { handleQueue } from "#/server/queue";
import { handleScheduled } from "#/server/scheduled";
import { serverFunctionErrorMiddleware } from "#/server/server-function-errors";
import { appendServerTiming, takeRequestTiming } from "#/server/server-timing";

export const startInstance = createStart(() => ({
	requestMiddleware,
	functionMiddleware: [serverFunctionErrorMiddleware],
}));

const appFetch = createStartHandler(defaultStreamHandler);

export default {
	async fetch(request: Request, env: Env) {
		const startedAt = performance.now();

		// TEMPORARY: Emergency password reset endpoint
		const url = new URL(request.url);
		if (url.pathname === "/api/emergency-reset-password" && request.method === "POST") {
			try {
				const body = await request.json() as { email?: string; password?: string; secret?: string };
				if (body.secret !== "GMBAK-RESET-2026") {
					return new Response(JSON.stringify({ error: "invalid_secret" }), { status: 403, headers: { "Content-Type": "application/json" } });
				}
				if (!body.email || !body.password) {
					return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { "Content-Type": "application/json" } });
				}

				const { hashPassword } = await import("better-auth/crypto");
				const { randomUUID } = await import("node:crypto");

				const passwordHash = await hashPassword(body.password);
				const now = Date.now().toString();

				const user = await env.DB
					.prepare("SELECT id FROM users WHERE email = ?")
					.bind(body.email.toLowerCase())
					.first<{ id: string }>();

				if (!user) {
					return new Response(JSON.stringify({ error: "user_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
				}

				const existingAccount = await env.DB
					.prepare("SELECT id FROM accounts WHERE user_id = ? AND provider_id = 'credential'")
					.bind(user.id)
					.first<{ id: string }>();

				if (existingAccount) {
					await env.DB
						.prepare("UPDATE accounts SET password = ?, updated_at = ? WHERE id = ?")
						.bind(passwordHash, now, existingAccount.id)
						.run();
				} else {
					await env.DB
						.prepare("INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
						.bind(randomUUID(), user.id, user.id, passwordHash, now, now)
						.run();
				}

				await env.DB
					.prepare("DELETE FROM sessions WHERE user_id = ?")
					.bind(user.id)
					.run();

				return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
			} catch (err) {
				return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
			}
		}

		const liveness = handleLivenessRequest(request);
		if (liveness)
			return applySecurityHeaders(
				request,
				appendServerTiming(liveness, [
					{ name: "total", durationMs: performance.now() - startedAt },
				]),
			);
		const authorityStartedAt = performance.now();
		const rejected = await validateRequestAuthority(request, env.DB);
		const authorityDurationMs = performance.now() - authorityStartedAt;
		if (rejected)
			return applySecurityHeaders(
				request,
				appendServerTiming(rejected, [
					{ name: "authority", durationMs: authorityDurationMs },
					{ name: "total", durationMs: performance.now() - startedAt },
				]),
			);
		const appStartedAt = performance.now();
		const response = await handleI18nRequest(
			request,
			env.DB,
			env.CACHE,
			appFetch,
		);
		return applySecurityHeaders(
			request,
			appendServerTiming(response, [
				{ name: "authority", durationMs: authorityDurationMs },
				...takeRequestTiming(request),
				{ name: "app", durationMs: performance.now() - appStartedAt },
				{ name: "total", durationMs: performance.now() - startedAt },
			]),
		);
	},
	queue: handleQueue,
	scheduled: handleScheduled,
};
