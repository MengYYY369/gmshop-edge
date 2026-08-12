import { z } from "zod";
import type {
	PaymentProviderAdapter,
	PaymentQuery,
} from "#/features/shop-payments/provider";
import { paypalCredentialSchema } from "#/features/shop-payments/provider";
import { sha256Hex } from "#/features/shop-payments/signature";
import { DomainError } from "#/lib/domain-error";
import { minorToDecimal } from "#/lib/units";
import { readPaymentWebhookText } from "./webhook-body";

const PAYPAL_API_SANDBOX = "https://api-m.sandbox.paypal.com";
const PAYPAL_API_LIVE = "https://api-m.paypal.com";

const orderResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
	links: z.array(
		z.object({
			href: z.string(),
			rel: z.string(),
			method: z.string(),
		}),
	),
	purchase_units: z
		.array(
			z.object({
				amount: z
					.object({
						currency_code: z.string(),
						value: z.string(),
					})
					.optional(),
			}),
		)
		.optional(),
});

const captureResponseSchema = z.object({
	id: z.string(),
	status: z.enum([
		"COMPLETED",
		"DECLINED",
		"PARTIALLY_REFUNDED",
		"PENDING",
		"REFUNDED",
	]),
	amount: z
		.object({
			currency_code: z.string(),
			value: z.string(),
		})
		.optional(),
});

const refundResponseSchema = z.object({
	id: z.string(),
	status: z.enum(["COMPLETED", "FAILED", "PENDING", "CANCELLED"]),
});

const webhookEventSchema = z.object({
	id: z.string(),
	event_type: z.string(),
	resource: z.object({
		id: z.string(),
		status: z.string().optional(),
		amount: z
			.object({
				currency_code: z.string(),
				value: z.string(),
			})
			.optional(),
		custom_id: z.string().optional(),
		supplementary_data: z
			.object({
				related_ids: z
					.object({
						order_id: z.string().optional(),
					})
					.optional(),
			})
			.optional(),
		// PayPal CAPTURE.COMPLETED webhook 的 purchase_units 通常只含
		// custom_id + amount，不一定有 payments（payments 出现在订单查询 API 响应里）。
		purchase_units: z
			.array(
				z
					.object({
						custom_id: z.string().optional(),
						amount: z
							.object({
								currency_code: z.string(),
								value: z.string(),
							})
							.optional(),
						payments: z
							.object({
								captures: z
									.array(
										z.object({
											id: z.string().optional(),
											status: z.string().optional(),
											amount: z
												.object({
													currency_code: z.string(),
													value: z.string(),
												})
												.optional(),
										}),
									)
									.optional(),
							})
							.passthrough()
							.optional(),
					})
					.passthrough(),
			)
			.optional(),
		final_capture: z.boolean().optional(),
		links: z.array(z.object({}).passthrough()).optional(),
	})
		.passthrough(),
	event_version: z.string().optional(),
	resource_type: z.string().optional(),
	summary: z.string().optional(),
	create_time: z.string().optional(),
	update_time: z.string().optional(),
})
	.passthrough();

const webhookVerificationSchema = z.object({
	verification_status: z.literal("SUCCESS"),
});

function baseUrl(credential: { isSandbox?: boolean }) {
	return credential.isSandbox ? PAYPAL_API_SANDBOX : PAYPAL_API_LIVE;
}

async function getAccessToken(
	credential: { clientId: string; clientSecret: string; isSandbox?: boolean },
	fetcher: typeof fetch,
) {
	const auth = btoa(`${credential.clientId}:${credential.clientSecret}`);
	const response = await fetcher(
		`${baseUrl(credential)}/v1/oauth2/token`,
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ grant_type: "client_credentials" }),
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!response.ok)
		throw new DomainError(
			"payment_provider_unavailable",
			502,
			"PayPal authentication failed",
		);
	const data = (await response.json()) as { access_token?: string };
	if (!data.access_token)
		throw new DomainError(
			"payment_provider_invalid_response",
			502,
			"PayPal returned an invalid auth response",
		);
	return data.access_token;
}

async function paypalRequest(
	accessToken: string,
	path: string,
	options: {
		method?: string;
		body?: unknown;
		baseUrl: string;
		fetcher: typeof fetch;
	},
) {
	const { method = "GET", body, baseUrl: apiBase, fetcher } = options;
	const response = await fetcher(`${apiBase}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
			"PayPal-Request-Id": crypto.randomUUID(),
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new DomainError(
			"payment_provider_unavailable",
			502,
			`PayPal API error: ${response.status} ${text.slice(0, 200)}`,
		);
	}
	return response;
}

export const paypalPaymentProvider: PaymentProviderAdapter = {
	checkoutPresentation: "redirect",
	refundMode: "automatic",
	async createPayment(input, rawCredential, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		const accessToken = await getAccessToken(credential, fetcher);
		const response = await paypalRequest(accessToken, "/v2/checkout/orders", {
			method: "POST",
			baseUrl: baseUrl(credential),
			body: {
				intent: "CAPTURE",
				purchase_units: [
					{
						description: input.description.slice(0, 127),
						custom_id: input.attemptId,
						amount: {
							currency_code: input.currency.toUpperCase(),
							value: minorToDecimal(input.amountMinor, input.currencyDecimals),
						},
					},
				],
				payment_source: {
					paypal: {
						experience_context: {
							payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
							brand_name: input.description.slice(0, 127),
							locale: "en-US",
							landing_page: "LOGIN",
							shipping_preference: "NO_SHIPPING",
							user_action: "PAY_NOW",
							return_url: input.successUrl,
							cancel_url: input.cancelUrl,
						},
					},
				},
			},
			fetcher,
		});
		const order = orderResponseSchema.parse(await response.json());
		// PayPal v2 API may return 'approve' (classic) or 'payer-action' (newer integrations)
		const approveLink = order.links.find(
			(link) => link.rel === "approve" || link.rel === "payer-action",
		);
		if (!approveLink)
			throw new DomainError(
				"payment_provider_invalid_response",
				502,
				`PayPal order missing approve/payer-action link. Available rels: ${order.links.map((l) => l.rel).join(",")}`,
			);
		return {
			providerPaymentId: order.id,
			checkoutUrl: approveLink.href,
			expiresAt: null,
		};
	},
	async queryPayment(providerPaymentId, rawCredential, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		const accessToken = await getAccessToken(credential, fetcher);
		const response = await paypalRequest(
			accessToken,
			`/v2/checkout/orders/${encodeURIComponent(providerPaymentId)}`,
			{
				baseUrl: baseUrl(credential),
				fetcher,
			},
		);
		const order = orderResponseSchema.parse(await response.json());
		const status: PaymentQuery["status"] =
			order.status === "COMPLETED"
				? "succeeded"
				: order.status === "VOIDED"
					? "failed"
					: "pending";
		const amount = order.purchase_units?.[0]?.amount;
		return {
			status,
			amountMinor: null,
			currency: amount?.currency_code?.toUpperCase() ?? null,
		};
	},
	async parseWebhook(request: Request, rawCredential: unknown, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		if (request.method !== "POST")
			throw new DomainError(
				"invalid_payment_callback",
				405,
				"Invalid payment callback method",
			);
		const body = await readPaymentWebhookText(request);
		const event = webhookEventSchema.parse(JSON.parse(body));
		const transmissionId = request.headers.get("paypal-transmission-id") ?? "";
		const certUrl = request.headers.get("paypal-cert-url") ?? "";
		const authAlgo = request.headers.get("paypal-auth-algo") ?? "";
		const transmissionSig =
			request.headers.get("paypal-transmission-sig") ?? "";
		const transmissionTime =
			request.headers.get("paypal-transmission-time") ?? "";
		const accessToken = await getAccessToken(credential, fetcher);
		const verifyResponse = await paypalRequest(
			accessToken,
			"/v1/notifications/verify-webhook-signature",
			{
				method: "POST",
				baseUrl: baseUrl(credential),
				body: {
					auth_algo: authAlgo,
					cert_url: certUrl,
					transmission_id: transmissionId,
					transmission_sig: transmissionSig,
					transmission_time: transmissionTime,
					webhook_id: credential.webhookId,
					webhook_event: JSON.parse(body),
				},
				fetcher,
			},
		);
		const verification = webhookVerificationSchema.parse(
			await verifyResponse.json(),
		);
		if (verification.verification_status !== "SUCCESS")
			throw new DomainError(
				"invalid_payment_signature",
				401,
				"Invalid PayPal webhook signature",
			);
		// PayPal 在买家 approve 时还可能发 CHECKOUT.ORDER.APPROVED /
		// CHECKOUT.ORDER.COMPLETED 等 event_type。intent=CAPTURE 场景下这些事件
		// 同样代表支付完成（PayPal 在 approve 后立即自动捕获）。
		const succeeded =
			event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
			event.event_type === "CHECKOUT.ORDER.APPROVED" ||
			event.event_type === "CHECKOUT.ORDER.COMPLETED";
		const failed =
			event.event_type === "PAYMENT.CAPTURE.DENIED" ||
			event.event_type === "PAYMENT.CAPTURE.REVERSED" ||
			event.event_type === "PAYMENT.CAPTURE.REFUNDED";
		// CHECKOUT.ORDER.APPROVED 未必在 resource 顶层有 amount；
		// 优先顶层 → captures → purchase_units[0]（pay-as-you-go 场景）。
		const amount =
			event.resource?.amount ??
			event.resource.purchase_units?.[0]?.payments?.captures?.[0]?.amount ??
			event.resource.purchase_units?.[0]?.amount ??
			undefined;
		const captureId = event.resource.id;
		// 尝试多种方式获取我们的 attemptId：优先 resource.custom_id，
		// 其次 purchase_units[0].custom_id。
		const orderIdFromCapture =
			event.resource.supplementary_data?.related_ids?.order_id ?? undefined;
		const customId =
			event.resource.custom_id ??
			event.resource.purchase_units?.[0]?.custom_id ??
			undefined;
		return {
			providerEventId: event.id,
			// capture ID 作为 providerPaymentId；merchantOrderId 优先用
			// custom_id（=我们的 attemptId），其次 order_id（= PayPal order ID），
			// 最后兜底 capture ID。
			providerPaymentId: captureId,
			merchantOrderId: customId ?? orderIdFromCapture ?? captureId,
			type: succeeded
				? "payment_succeeded"
				: failed
					? "payment_failed"
					: "payment_pending",
			amountMinor: null,
			amountDecimal: amount?.value ?? null,
			currency: amount?.currency_code?.toUpperCase() ?? null,
			payloadDigest: await sha256Hex(body),
		};
	},
	async refundPayment(input, rawCredential, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		const accessToken = await getAccessToken(credential, fetcher);
		const response = await paypalRequest(
			accessToken,
			`/v2/payments/captures/${encodeURIComponent(input.providerPaymentId)}/refund`,
			{
				method: "POST",
				baseUrl: baseUrl(credential),
				body: input.amountMinor
					? {
							amount: {
								value: minorToDecimal(input.amountMinor, 2),
							},
							note_to_payer: input.reason.slice(0, 255),
						}
					: undefined,
				fetcher,
			},
		);
		const refund = refundResponseSchema.parse(await response.json());
		return {
			providerRefundId: refund.id,
			status:
				refund.status === "COMPLETED"
					? "succeeded"
					: refund.status === "FAILED"
						? "failed"
						: refund.status === "CANCELLED"
							? "cancelled"
							: "pending",
			failureCode: null,
		};
	},
	async queryRefund(providerRefundId, rawCredential, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		const accessToken = await getAccessToken(credential, fetcher);
		const response = await paypalRequest(
			accessToken,
			`/v2/payments/refunds/${encodeURIComponent(providerRefundId)}`,
			{
				baseUrl: baseUrl(credential),
				fetcher,
			},
		);
		const refund = refundResponseSchema.parse(await response.json());
		return {
			providerRefundId: refund.id,
			status:
				refund.status === "COMPLETED"
					? "succeeded"
					: refund.status === "FAILED"
						? "failed"
						: refund.status === "CANCELLED"
							? "cancelled"
							: "pending",
			failureCode: null,
		};
	},
	async checkHealth(rawCredential, fetcher = fetch) {
		const credential = paypalCredentialSchema.parse(rawCredential);
		await getAccessToken(credential, fetcher);
	},
};
