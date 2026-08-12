import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { syncOrderPaymentStatus } from "#/features/shop-payments/server/payment-sync";
import { getDb } from "#/server/db.server";
import { resolveStoreAccount } from "./account";
import { getStoreOrder } from "./order-query";

const syncPaymentStatusInputSchema = z.object({
	orderNumber: z.string().trim().toUpperCase().min(8).max(80),
	email: z.string().trim().toLowerCase().email().max(320).optional(),
});

/**
 * 订单页面加载时立即调用，主动同步支付状态。
 * 对于 PayPal 等 webhook 有延迟的方式，可以将延迟从 ~10秒 降低到 <1秒。
 */
export const syncPaymentStatusFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof syncPaymentStatusInputSchema>) =>
		syncPaymentStatusInputSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const request = getRequest();
		const db = getDb(request).$client;
		const account = await resolveStoreAccount(db, request);
		const order = await getStoreOrder(
			db,
			data.email
				? { orderNumber: data.orderNumber, email: data.email }
				: { orderNumber: data.orderNumber },
			account ? { userId: account.user.id } : {},
		);
		if (order.status !== "pending_payment") {
			return {
				synced: false,
				reason: "order_not_pending",
				status: order.status,
			};
		}
		return syncOrderPaymentStatus(db, order.id);
	});
