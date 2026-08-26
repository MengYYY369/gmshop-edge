import { z } from "zod";

export const walletAmountSchema = z
	.string()
	.trim()
	.regex(/^(0|[1-9]\d*)$/)
	.refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, {
		message: "Amount exceeds the supported range",
	});

export const walletAdjustmentSchema = z.object({
	userId: z.uuid(),
	direction: z.enum(["credit", "debit"]),
	amountMinor: walletAmountSchema.refine((value) => value !== "0"),
	reason: z.string().trim().min(1).max(500),
	idempotencyKey: z.string().trim().min(8).max(200),
});

export const walletTopupSchema = z.object({
	amountMinor: walletAmountSchema.refine((value) => value !== "0"),
	channelId: z.uuid(),
	idempotencyKey: z.string().trim().min(8).max(200),
	paymentCurrency: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z]{3}$/)
		.optional(),
});
