import { z } from "zod";
import type {
	PaymentProviderAdapter,
	PaymentQuery,
} from "#/features/shop-payments/provider";
import { epayV1CredentialSchema } from "#/features/shop-payments/provider";
import { sha256Hex } from "#/features/shop-payments/signature";
import { DomainError } from "#/lib/domain-error";
import { minorToDecimal } from "#/lib/units";
import {
	epusdtMerchantOrderId,
	epusdtUrl,
	manualRefundMethods,
	parseEpusdtJson,
	signEpusdt,
	verifyEpusdtSignature,
} from "./epusdt";

const callbackSchema = z.object({
	pid: z.string().min(1),
	trade_no: z.string().min(1),
	out_trade_no: z.string().min(1),
	money: z.string().regex(/^\d+(?:\.\d+)?$/),
	trade_status: z.literal("TRADE_SUCCESS"),
	sign: z.string().min(1),
	sign_type: z.string().toUpperCase().pipe(z.literal("MD5")),
});

const mapiResponseSchema = z.object({
	code: z.union([z.literal(1), z.literal("1")]),
	msg: z.string(),
	trade_no: z.string().min(1),
	money: z.string(),
	out_trade_no: z.string().optional(),
	type: z.string().optional(),
	payurl: z.string().optional(),
	qrcode: z.string().optional(),
	urlscheme: z.string().optional(),
	h5_url: z.string().optional(),
});

const epayV1OrderQuerySchema = z.object({
	code: z.union([z.literal(1), z.literal("1")]),
	msg: z.string(),
	trade_no: z.string(),
	out_trade_no: z.string(),
	status: z.number().int(),
	money: z.string(),
	name: z.string(),
	type: z.string(),
});

export const epayV1PaymentProvider: PaymentProviderAdapter = {
	checkoutPresentation: "qr",
	refundMode: "manual",
	async createPayment(input, rawCredential, fetcher = fetch) {
		const credential = epayV1CredentialSchema.parse(rawCredential);
		const params: Record<string, string> = {
			pid: credential.pid,
			type: credential.paymentMethod,
			out_trade_no: epusdtMerchantOrderId(input.attemptId),
			notify_url: input.webhookUrl,
			return_url: input.successUrl,
			name: input.description,
			money: minorToDecimal(input.amountMinor, input.currencyDecimals),
			sign_type: "MD5",
			clientip: input.payerIp || "127.0.0.1",
		};
		if (input.payerMobile) params.device = "mobile";
		params.sign = signEpusdt(
			params,
			credential.secretKey,
			new Set(["sign", "sign_type"]),
		);
		let response: Response;
		try {
			response = await fetcher(
				epusdtUrl(credential.baseUrl, "/mapi.php"),
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(params),
					signal: AbortSignal.timeout(15_000),
				},
			);
		} catch (error) {
			throw new DomainError(
				"payment_provider_network_error",
				502,
				`无法连接到支付平台: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const json = await parseEpusdtJson(response);
		const result = mapiResponseSchema.parse(json);
		// 安全校验：EPay 返回的金额必须与请求金额一致
		const requestedMoney = minorToDecimal(input.amountMinor, input.currencyDecimals);
		if (result.money && result.money !== requestedMoney) {
			throw new DomainError(
				"payment_amount_mismatch",
				502,
				`EPay 返回金额 ${result.money} 与请求金额 ${requestedMoney} 不一致，可能是商户账户配置异常`,
			);
		}
		// h5_url is the Alipay deeplink - best for mobile redirect or QR code on desktop.
		// qrcode/web jump URL is a fallback (desktop shows "loading forever" for the jump page).
		const checkoutUrl =
			result.h5_url ??
			result.payurl ??
			result.urlscheme ??
			result.qrcode ??
			result.out_trade_no ??
			result.trade_no;
		if (!checkoutUrl) {
			throw new DomainError(
				"payment_provider_invalid_response",
				502,
				`支付平台响应缺少支付URL: ${JSON.stringify(json)}`,
			);
		}
		return {
			providerPaymentId: result.trade_no,
			checkoutUrl,
			expiresAt: null,
		};
	},
	async queryPayment(providerPaymentId, rawCredential, fetcher = fetch) {
		const credential = epayV1CredentialSchema.parse(rawCredential);
		const url = new URL(epusdtUrl(credential.baseUrl, "/api.php"));
		url.searchParams.set("act", "order");
		url.searchParams.set("pid", credential.pid);
		url.searchParams.set("key", credential.secretKey);
		url.searchParams.set("trade_no", providerPaymentId);
		const result = epayV1OrderQuerySchema.parse(
			await parseEpusdtJson(
				await fetcher(url.toString(), { signal: AbortSignal.timeout(10_000) }),
			),
		);
		const status: PaymentQuery["status"] =
			result.status === 1 ? "succeeded" : "pending";
		return {
			status,
			amountMinor: null,
			currency: null,
		};
	},
	async parseWebhook(request, rawCredential) {
		const credential = epayV1CredentialSchema.parse(rawCredential);
		if (request.method !== "GET")
			throw new DomainError(
				"invalid_payment_callback",
				405,
				"Invalid payment callback method",
			);
		const url = new URL(request.url);
		const params = Object.fromEntries(url.searchParams);
		verifyEpusdtSignature(params, credential.secretKey, "sign");
		const event = callbackSchema.parse(params);
		if (event.pid !== credential.pid)
			throw new DomainError(
				"invalid_payment_signature",
				401,
				"Invalid payment credential",
			);
		return {
			providerEventId: `epay_v1:${event.trade_no}:${event.trade_status}`,
			providerPaymentId: event.trade_no,
			type: "payment_succeeded",
			amountMinor: null,
			amountDecimal: event.money,
			currency: null,
			merchantOrderId: event.out_trade_no,
			payloadDigest: await sha256Hex(url.searchParams.toString()),
		};
	},
	...manualRefundMethods,
	async checkHealth(rawCredential, fetcher = fetch) {
		const credential = epayV1CredentialSchema.parse(rawCredential);
		// EPay V1 (zeyuyun-style) has no /api.php and /mapi.php always requires a
		// signature + order params. A real health check would create a spurious
		// order, so we only verify connectivity: a POST to /mapi.php with any body
		// returns valid JSON (code:0 for missing fields) when the API is up.
		// A 404 or HTML page means the URL is wrong.
		const response = await fetcher(
			epusdtUrl(credential.baseUrl, "/mapi.php"),
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: `pid=${encodeURIComponent(credential.pid)}`,
				signal: AbortSignal.timeout(10_000),
			},
		);
		const json = z
			.object({ code: z.union([z.number(), z.string()]) })
			.parse(await parseEpusdtJson(response));
		if (json.code === 1 || json.code === "1") return;
	},
};
