import { z } from "zod";
import { handleTelegramUpdate } from "./bot";
import {
	constantTimeStringEqual,
	deriveTelegramWebhookSecret,
	telegramWebhookSigningKeyId,
} from "./secret";
import { telegramRuntime } from "./sync";

const telegramUpdateSchema = z.looseObject({
	update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export async function processTelegramWebhook(
	db: D1Database,
	body: string,
	providedSecret: string,
) {
	const { runtime, settings, provider } = await telegramRuntime(db);
	if (
		settings.status !== "active" ||
		!runtime.automationCallbackSecret ||
		!provider?.telegramBotToken ||
		!settings.syncedBotUserId ||
		provider.revision !== settings.syncedRevision ||
		(await telegramWebhookSigningKeyId(runtime.automationCallbackSecret)) !==
			settings.syncedDataKeyId ||
		safeOrigin(runtime.betterAuthUrl) !== settings.syncedOrigin
	)
		return { accepted: false, inactive: true };
	const expectedSecret = await deriveTelegramWebhookSecret(
		runtime.automationCallbackSecret,
		settings.syncedBotUserId,
		settings.syncedRevision,
	);
	if (!constantTimeStringEqual(providedSecret, expectedSecret))
		throw new TelegramWebhookError("invalid_secret", 401);
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		throw new TelegramWebhookError("invalid_json", 400);
	}
	const update = telegramUpdateSchema.safeParse(value);
	if (!update.success) throw new TelegramWebhookError("invalid_update", 400);
	const receiptId = crypto.randomUUID();
	const now = Date.now();
	const digest = await sha256(body);
	const reserved = await db
		.prepare(
			`INSERT INTO replay_receipts
			 (id, namespace, scope_id, external_id, event_type, payload_digest,
			  status, created_at, updated_at)
			 VALUES (?, 'telegram_update', ?, ?, 'update', ?, 'received', ?, ?)
			 ON CONFLICT(namespace, scope_id, external_id) DO NOTHING`,
		)
		.bind(
			receiptId,
			settings.syncedBotUserId,
			String(update.data.update_id),
			digest,
			now,
			now,
		)
		.run();
	if (Number(reserved.meta.changes ?? 0) !== 1)
		return { accepted: true, duplicate: true };
	try {
		await handleTelegramUpdate(db, update.data);
		await db
			.prepare(
				`UPDATE replay_receipts SET status = 'processed', processed_at = ?,
				 updated_at = ? WHERE id = ?`,
			)
			.bind(now, now, receiptId)
			.run();
		return { accepted: true };
	} catch (error) {
		await db
			.prepare("DELETE FROM replay_receipts WHERE id = ?")
			.bind(receiptId)
			.run();
		throw error;
	}
}

function safeOrigin(value: string) {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

export class TelegramWebhookError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
		this.name = "TelegramWebhookError";
	}
}

async function sha256(value: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
