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
	code: z.literal(1),
	msg: z.string(),
	data: z.object({
		trade_no: z.string().min(1),
		out_trade_no: z.string().min(1),
		money: z.string(),
		type: z.string(),
		payurl: z.string().optional(),
		qrcode: z.string().optional(),
		urlscheme: z.string().optional(),
	}),
});

const epayV1HealthResponseSchema = z.object({
	code: z.literal(1),
	pid: z.number().int().positive(),
	active: z.literal(1).optional(),
});

const epayV1OrderQuerySchema = z.object({
	code: z.literal(1),
	msg: z.string(),
	trade_no: z.string(),
	out_trade_no: z.string(),
	status: z.number().int(),
	money: z.string(),
	name: z.string(),
	type: z.string(),
});

export const epayV1PaymentProvider: PaymentProviderAdapter = {
	checkoutPresentation: "redirect",
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
		};
		if (input.payerIp) params.clientip = input.payerIp;
		if (input.payerMobile) params.device = "mobile";
		params.sign = signEpusdt(
			params,
			credential.secretKey,
			new Set(["sign", "sign_type"]),
		);
		const response = await fetcher(
			epusdtUrl(credential.baseUrl, "/mapi.php"),
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams(params),
				signal: AbortSignal.timeout(15_000),
			},
		);
		const result = mapiResponseSchema.parse(await parseEpusdtJson(response));
		const checkoutUrl =
			result.data.payurl ??
			result.data.qrcode ??
			result.data.urlscheme ??
			result.data.out_trade_no;
		return {
			providerPaymentId: result.data.trade_no,
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
		const url = new URL(epusdtUrl(credential.baseUrl, "/api.php"));
		url.searchParams.set("act", "query");
		url.searchParams.set("pid", credential.pid);
		url.searchParams.set("key", credential.secretKey);
		const response = await fetcher(url.toString(), {
			signal: AbortSignal.timeout(10_000),
		});
		epayV1HealthResponseSchema.parse(await parseEpusdtJson(response));
	},
};
