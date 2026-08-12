import type { PaymentWebhookEvent } from "#/features/shop-payments/provider";
import { getPaymentProvider } from "#/features/shop-payments/providers";
import { sha256Hex } from "#/features/shop-payments/signature";
import { DomainError } from "#/lib/domain-error";
import { decryptSecret } from "#/lib/secrets";
import { loadRuntimeConfig } from "#/server/runtime-config";
import { processShopPaymentEvent } from "./service";

async function loadCredential(db: D1Database, encrypted: string | null) {
	if (!encrypted) return {};
	const runtime = await loadRuntimeConfig(db);
	if (!runtime.commerceSecret)
		throw new DomainError(
			"payment_secret_unavailable",
			503,
			"Payment configuration unavailable",
		);
	return JSON.parse(
		await decryptSecret(encrypted, runtime.commerceSecret, "payment-credential"),
	) as unknown;
}

/**
 * 主动向支付提供商查询订单最新状态。
 * 如果提供商返回 succeeded，构造合成事件复用 processShopPaymentEvent 的完整流程。
 * 用于订单页面加载时立即同步 PayPal 等 webhook 有延迟的支付方式。
 */
export async function syncOrderPaymentStatus(
	db: D1Database,
	orderId: string,
	fetcher: typeof fetch = fetch,
) {
	const attempt = await db
		.prepare(
			`SELECT pa.id, pa.provider_payment_id, pa.channel_id, pa.status,
			        pc.provider, pc.credential_encrypted
			 FROM payment_attempts pa
			 JOIN payment_channels pc ON pc.id = pa.channel_id
			 WHERE pa.order_id = ?
			 ORDER BY pa.created_at DESC, pa.id DESC
			 LIMIT 1`,
		)
		.bind(orderId)
		.first<{
			id: string;
			provider_payment_id: string;
			channel_id: string;
			status: string;
			provider: string;
			credential_encrypted: string | null;
		}>();
	if (!attempt) return { synced: false, reason: "no_payment_attempt" };
	if (attempt.status !== "pending") {
		return { synced: false, reason: "not_pending", status: attempt.status };
	}
	const credential = await loadCredential(db, attempt.credential_encrypted);
	const queryResult = await getPaymentProvider(attempt.provider).queryPayment(
		attempt.provider_payment_id,
		credential,
		fetcher,
	);
	if (queryResult.status !== "succeeded") {
		return {
			synced: false,
			reason: "provider_not_succeeded",
			providerStatus: queryResult.status,
		};
	}
	const syntheticEvent: PaymentWebhookEvent = {
		providerEventId: `sync:${Date.now()}:${attempt.id}`,
		providerPaymentId: attempt.provider_payment_id,
		type: "payment_succeeded",
		amountMinor: queryResult.amountMinor,
		currency: queryResult.currency,
		merchantOrderId: attempt.id,
		payloadDigest: await sha256Hex(`sync:${attempt.id}`),
	};
	const eventResult = await processShopPaymentEvent(
		db,
		attempt.channel_id,
		syntheticEvent,
	);
	return { synced: true, status: "succeeded", ...eventResult };
}
