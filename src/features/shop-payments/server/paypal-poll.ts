import { getPaymentProvider } from "#/features/shop-payments/provider";
import { loadCredential } from "#/features/shop-payments/server/service";

/**
 * 主动轮询PayPal待支付订单状态
 * PayPal webhook有时会有延迟，通过主动轮询加速订单状态更新
 * 
 * 每次cron触发时（每分钟）检查待支付的PayPal订单，
 * 如果PayPal API返回COMPLETED，直接将payment_attempt标记为succeeded，
 * 后续的publishPendingDeliveries会处理履约。
 */
export async function pollPendingPayPalPayments(db: D1Database, limit = 10) {
	// 查找状态为pending且创建时间不超过1小时的PayPal支付尝试
	const pendingAttempts = await db
		.prepare(
			`SELECT pa.id, pa.provider_payment_id, pa.channel_id, pa.created_at,
			        pc.credential_encrypted
			 FROM payment_attempts pa
			 JOIN payment_channels pc ON pc.id = pa.channel_id
			 WHERE pa.status = 'pending'
			   AND pc.provider = 'paypal'
			   AND pa.created_at > ?
			 ORDER BY pa.created_at DESC
			 LIMIT ?`,
		)
		.bind(Date.now() - 60 * 60 * 1000, limit)
		.all<{
			id: string;
			provider_payment_id: string;
			channel_id: string;
			created_at: number;
			credential_encrypted: string | null;
		}>();

	if (!pendingAttempts.results?.length) return { polled: 0, updated: 0 };

	const now = Date.now();
	let updated = 0;

	for (const attempt of pendingAttempts.results) {
		if (!attempt.credential_encrypted) continue;
		try {
			const credential = await loadCredential(db, attempt.credential_encrypted);
			const provider = getPaymentProvider("paypal");
			const result = await provider.queryPayment(
				attempt.provider_payment_id,
				credential,
			);
			if (result.status === "succeeded") {
				// 直接标记为succeeded，后续cron会触发履约
				await db
					.prepare(
						"UPDATE payment_attempts SET status = 'succeeded', updated_at = ? WHERE id = ? AND status = 'pending'",
					)
					.bind(now, attempt.id)
					.run();
				updated++;
			} else if (result.status === "failed") {
				await db
					.prepare(
						"UPDATE payment_attempts SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'",
					)
					.bind(now, attempt.id)
					.run();
			}
		} catch {
			// 查询失败时跳过，下次cron再试
		}
	}

	return { polled: pendingAttempts.results.length, updated };
}
