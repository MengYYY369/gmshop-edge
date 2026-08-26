import { z } from "zod";

export const shopOrderStatuses = [
	"pending_payment",
	"paid",
	"fulfilling",
	"completed",
	"cancelled",
	"expired",
	"refunding",
	"refunded",
	"failed",
] as const;

export const adminOrderListSchema = z.object({
	pageIndex: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(100).default(10),
	search: z.string().trim().max(200).default(""),
});

export const orderIdSchema = z.object({ id: z.uuid() });

export const orderTransitionSchema = z.object({
	id: z.uuid(),
	version: z.number().int().positive(),
	toStatus: z.enum(shopOrderStatuses),
	note: z
		.string()
		.trim()
		.max(2_000)
		.transform((value) => value || null),
});

export const orderAdminNoteSchema = z.object({
	id: z.uuid(),
	note: z
		.string()
		.trim()
		.max(2_000)
		.transform((value) => value || null),
});

export const refundRequestSchema = z.object({
	orderId: z.uuid(),
	amountMinor: z.string().regex(/^\d+$/),
	reason: z.string().trim().min(1).max(2_000),
	idempotencyKey: z.string().trim().min(8).max(200),
});

export const manualRefundCompletionSchema = z.object({
	id: z.uuid(),
	reference: z.string().trim().min(1).max(200),
});

export const afterSaleTypeValues = [
	"refund",
	"redelivery",
	"rebuild",
	"dispute",
] as const;

export const afterSaleStatusValues = [
	"open",
	"processing",
	"resolved",
	"rejected",
	"closed",
] as const;

export const afterSaleOpenSchema = z.object({
	orderId: z.uuid(),
	orderItemId: z.uuid().nullable().default(null),
	type: z.enum(afterSaleTypeValues),
	reason: z.string().trim().min(5).max(2_000),
});

export const afterSaleUpdateSchema = z.object({
	id: z.uuid(),
	status: z.enum(afterSaleStatusValues),
	resolution: z.string().trim().max(4_000).default(""),
	note: z.string().trim().max(2_000).default(""),
});

export type AfterSaleStatus = (typeof afterSaleStatusValues)[number];

export type ShopOrderStatus = (typeof shopOrderStatuses)[number];
