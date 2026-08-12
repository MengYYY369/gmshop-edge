import { z } from "zod";
import type { PaymentProviderAdapter } from "#/features/shop-payments/provider";
import { gmpayCredentialSchema } from "#/features/shop-payments/provider";
import { sha256Hex } from "#/features/shop-payments/signature";
import { DomainError } from "#/lib/domain-error";
import { minorToDecimal } from "#/lib/units";
import {
	epusdtMerchantOrderId,
	epusdtUrl,
	manualRefundMethods,
	parseEpusdtJson,
	scalarRecord,
	signGmpay,
	verifyGmpaySignature,
} from "./epusdt";
import { readPaymentWebhookText } from "./webhook-body";

const createResponseSchema = z.object({
	status_code: z.literal(200),
	data: z.object({
		trade_id: z.string().min(1),
		payment_url: z.url(),
		expiration_time: z.number().int().positive(),
	}),
});

const callbackSchema = z.object({
	pid: z.string().min(1),
	trade_id: z.string().min(1),
	order_id: z.string().min(1),
	amount: z.string().regex(/^\d+(?:\.\d+)?$/),
	block_transaction_id: z.string().default(""),
	actual_amount: z
		.string()
		.regex(/^\d+(?:\.\d+)?$/)
		.default("0"),
	status: z.enum([
		"pending",
		"confirming",
		"paid",
		"partially_paid",
		"overpaid",
		"expired",
		"cancelled",
		"failed",
		"refunded",
	]),
	signature: z.string().min(1),
});

const queryResponseSchema = z.object({
	status_code: z.literal(200),
	data: z.object({
		trade_id: z.string().min(1),
		order_id: z.string().min(1),
		amount: z.string().regex(/^\d+(?:\.\d+)?$/),
		currency: z.string().length(3),
		status: callbackSchema.shape.status,
	}),
});

export const gmpayPaymentProvider: PaymentProviderAdapter = {
	checkoutPresentation: "redirect",
	refundMode: "manual",
	async createPayment(input, rawCredential, fetcher = fetch) {
		const credential = gmpayCredentialSchema.parse(rawCredential);
		const params: Record<string, string> = {
			pid: credential.pid,
			order_id: epusdtMerchantOrderId(input.attemptId),
			currency: input.currency.toUpperCase(),
			amount: minorToDecimal(input.amountMinor, input.currencyDecimals),
			notify_url: input.webhookUrl,
			redirect_url: input.successUrl,
			name: input.description,
		};
		// GMpay: token 和 network 必须同时提供才发送，否则让付款人通过统一收银台选择
		// GMpay文档说明："同时省略 token 与 network 会创建可选择支付方式的 pending 订单"
		if (input.defaultToken && input.defaultNetwork) {
			params.token = input.defaultToken;
			params.network = input.defaultNetwork;
		}
		params.signature = await signGmpay(params, credential.secretKey);
		const response = await fetcher(
			epusdtUrl(
				credential.baseUrl,
				"/payments/gmpay/v1/order/create-transaction",
			),
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams(params),
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new DomainError(
				"payment_provider_unavailable",
				502,
				`GMpay 不可用 (HTTP ${response.status})${text ? `: ${text.slice(0, 150)}` : ""}`,
			);
		}
		const body = await response.json().catch(() => null);
		if (!body || typeof body !== "object") {
			throw new DomainError(
				"payment_provider_invalid_response",
				502,
				"GMpay 返回了无效的响应格式",
			);
		}
		const result = createResponseSchema.safeParse(body);
		if (!result.success) {
			// GMpay 可能返回 {status_code: 10003, message: "...", data: null} 这类业务错误
			const errorCode = (body as { status_code?: number }).status_code;
			const errorMessage = (body as { message?: string }).message;
			if (errorCode && errorCode !== 200) {
				throw new DomainError(
					"payment_provider_rejected",
					502,
					`GMpay 错误 ${errorCode}: ${errorMessage ?? "未知错误"}`,
				);
			}
			throw new DomainError(
				"payment_provider_invalid_response",
				502,
				`GMpay 响应格式异常: ${result.error.issues.map((i) => i.message).join("; ")}`,
			);
		}
		return {
			providerPaymentId: result.data.data.trade_id,
			checkoutUrl: result.data.data.payment_url,
			expiresAt: result.data.data.expiration_time * 1000,
		};
	},
	async queryPayment(providerPaymentId, rawCredential, fetcher = fetch) {
		const credential = gmpayCredentialSchema.parse(rawCredential);
		const params = {
			pid: credential.pid,
			trade_id: providerPaymentId,
			signature: "",
		};
		params.signature = await signGmpay(params, credential.secretKey);
		const url = new URL(
			epusdtUrl(credential.baseUrl, "/payments/gmpay/v1/order/query"),
		);
		url.search = new URLSearchParams(params).toString();
		const response = await fetcher(url, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			throw new DomainError(
				"payment_provider_unavailable",
				502,
				`GMpay query failed (HTTP ${response.status})`,
			);
		}
		const body = await response.json().catch(() => null);
		const result = queryResponseSchema.safeParse(body);
		if (!result.success) {
			throw new DomainError(
				"payment_provider_invalid_response",
				502,
				`GMpay query response error: ${result.error.issues.map((i) => i.message).join("; ")}`,
			);
		}
		return {
			status:
				result.data.data.status === "paid" || result.data.data.status === "overpaid"
					? ("succeeded" as const)
					: result.data.data.status === "expired" ||
							result.data.data.status === "cancelled"
						? ("expired" as const)
						: result.data.data.status === "failed"
							? ("failed" as const)
							: ("pending" as const),
			amountMinor: null,
			currency: result.data.data.currency.toUpperCase(),
		};
	},
	async parseWebhook(request, rawCredential) {
		const credential = gmpayCredentialSchema.parse(rawCredential);
		if (request.method !== "POST")
			throw new DomainError(
				"invalid_payment_callback",
				405,
				"Invalid payment callback method",
			);
		const body = await readPaymentWebhookText(request);
		let raw: unknown;
		try {
			raw = JSON.parse(body);
		} catch {
			throw new DomainError(
				"invalid_payment_callback",
				400,
				"Invalid payment callback",
			);
		}
		const params = scalarRecord(raw);
		await verifyGmpaySignature(params, credential.secretKey);
		const event = callbackSchema.parse(params);
		if (event.pid !== credential.pid)
			throw new DomainError(
				"invalid_payment_signature",
				401,
				"Invalid payment credential",
			);
		return {
			providerEventId: `gmpay:${event.trade_id}:${event.block_transaction_id || event.status}`,
			providerPaymentId: event.trade_id,
			type:
				event.status === "paid" || event.status === "overpaid"
					? "payment_succeeded"
					: event.status === "expired" || event.status === "cancelled"
						? "payment_expired"
						: "payment_failed",
			amountMinor: null,
			amountDecimal: event.amount,
			currency: null,
			merchantOrderId: event.order_id,
			payloadDigest: await sha256Hex(body),
		};
	},
	...manualRefundMethods,
	async checkHealth(rawCredential, fetcher = fetch) {
		const credential = gmpayCredentialSchema.parse(rawCredential);
		try {
			const response = await fetcher(
				epusdtUrl(credential.baseUrl, "/healthz"),
				{
					method: "GET",
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (!response.ok)
				throw new DomainError(
					"payment_provider_unavailable",
					502,
					`GMpay healthz returned ${response.status}`,
				);
			const body = (await response.json()) as { status?: string };
			if (body.status !== "ok")
				throw new DomainError(
					"payment_provider_unavailable",
					502,
					`GMpay healthz status: ${body.status}`,
				);
		} catch (err) {
			if (err instanceof DomainError) throw err;
			throw new DomainError(
				"payment_provider_unavailable",
				502,
				`GMpay unreachable: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	},
};
