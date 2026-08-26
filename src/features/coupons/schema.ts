import { z } from "zod";

export const couponTypes = ["fixed", "percentage"] as const;
const idSchema = z.uuid();
const tagNameSchema = z.string().trim().min(1).max(50);
export const couponScopeSchema = z
	.object({
		productIds: z.array(idSchema).max(100).transform(uniqueValues),
		tagNames: z.array(tagNameSchema).max(100).transform(uniqueValues),
	})
	.strict();
const optionalMoney = z
	.union([z.string().trim().regex(/^\d+$/).max(40), z.literal("")])
	.transform((value) => value || null)
	.optional();
const optionalPositiveInteger = z
	.union([z.number().int().positive(), z.null()])
	.optional();

export const couponListSchema = z.object({
	pageIndex: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(100).default(10),
	search: z.string().trim().max(200).default(""),
});

export const couponInputSchema = z
	.object({
		id: idSchema.optional(),
		code: z
			.string()
			.trim()
			.toUpperCase()
			.regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/),
		name: z.string().trim().min(1).max(120),
		type: z.enum(couponTypes),
		currency: z
			.string()
			.trim()
			.toUpperCase()
			.refine((value) => !value || /^[A-Z]{3}$/.test(value))
			.transform((value) => value || null)
			.optional(),
		currencyDecimals: z.number().int().min(0).max(8).nullable().optional(),
		valueMinor: optionalMoney,
		valueBps: z.number().int().min(1).max(10_000).nullable().optional(),
		minimumOrderMinor: optionalMoney,
		maximumDiscountMinor: optionalMoney,
		usageLimit: optionalPositiveInteger,
		usageLimitPerCustomer: optionalPositiveInteger,
		startsAt: z.number().int().positive().nullable().optional(),
		endsAt: z.number().int().positive().nullable().optional(),
		enabled: z.boolean().default(true),
		productIds: z.array(idSchema).max(100).transform(uniqueValues),
		tagNames: z.array(tagNameSchema).max(100).transform(uniqueValues),
	})
	.superRefine((value, context) => {
		if (
			value.type === "fixed" &&
			(!value.currency || value.currencyDecimals == null || !value.valueMinor)
		) {
			context.addIssue({
				code: "custom",
				path: ["valueMinor"],
				message: "Fixed coupons require currency and value",
			});
		}
		if (value.type === "fixed" && value.valueBps != null) {
			context.addIssue({
				code: "custom",
				path: ["valueBps"],
				message: "Fixed coupons do not accept basis points",
			});
		}
		if (value.type === "percentage" && (!value.valueBps || value.valueMinor)) {
			context.addIssue({
				code: "custom",
				path: ["valueBps"],
				message: "Percentage coupons require basis points only",
			});
		}
		if (
			(value.minimumOrderMinor || value.maximumDiscountMinor) &&
			(!value.currency || value.currencyDecimals == null)
		) {
			context.addIssue({
				code: "custom",
				path: ["currency"],
				message: "Monetary thresholds require a currency",
			});
		}
		if ((value.currency == null) !== (value.currencyDecimals == null)) {
			context.addIssue({
				code: "custom",
				path: ["currencyDecimals"],
				message: "Currency and decimals must be configured together",
			});
		}
		if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
			context.addIssue({
				code: "custom",
				path: ["endsAt"],
				message: "Coupon end time must be after its start time",
			});
		}
		if (
			value.usageLimit &&
			value.usageLimitPerCustomer &&
			value.usageLimitPerCustomer > value.usageLimit
		) {
			context.addIssue({
				code: "custom",
				path: ["usageLimitPerCustomer"],
				message: "Per-customer usage cannot exceed total usage",
			});
		}
	});

export const couponIdSchema = z.object({ id: idSchema });

export const couponEnabledSchema = z.object({
	id: idSchema,
	enabled: z.boolean(),
});

function uniqueValues(values: string[]) {
	return [...new Set(values)];
}
