import { publishPendingDeliveries } from "#/features/fulfillment/server/outbox";
import { handleShopPaymentWebhook } from "#/features/shop-payments/server/service";
import { publishPendingSupplierOrders } from "#/features/suppliers/server/outbox";
import { DomainError } from "#/lib/domain-error";

export async function handleShopPaymentWebhookRequest(
	request: Request,
	channelId: string,
	env: Pick<Env, "DB" | "COMMERCE_QUEUE">,
) {
	try {
		const result = await handleShopPaymentWebhook(request, channelId, env.DB);
		await publishPendingDeliveries(env.DB, env.COMMERCE_QUEUE);
		await publishPendingSupplierOrders(env.DB, env.COMMERCE_QUEUE);
		if (result.provider === "gmpay" || result.provider === "epay")
			return new Response("ok", {
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "text/plain; charset=utf-8",
				},
			});
		if (result.provider === "epay_v1")
			return new Response("success", {
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "text/plain; charset=utf-8",
				},
			});
		if (result.provider === "alipay_page" || result.provider === "alipay_wap")
			return new Response("success", {
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "text/plain; charset=utf-8",
				},
			});
		if (result.provider === "wechat_native" || result.provider === "wechat_h5")
			return new Response(null, {
				status: 204,
				headers: { "Cache-Control": "no-store" },
			});
		return Response.json(result, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		if (error instanceof DomainError)
			return Response.json(
				{ code: error.code },
				{ status: error.status, headers: { "Cache-Control": "no-store" } },
			);
		return Response.json(
			{ code: "payment_webhook_failed" },
			{ status: 500, headers: { "Cache-Control": "no-store" } },
		);
	}
}
