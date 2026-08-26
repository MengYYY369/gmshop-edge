import { z } from "zod";
import { sensitiveProofSchema } from "#/features/auth/reauthentication-schema";
export const renewalModes = ["stack", "disabled"] as const;
export const deliveryEmailModes = ["none", "link", "content"] as const;
export const stockEntryStatuses = [
	"available",
	"reserved",
	"delivered",
	"disabled",
] as const;

const idSchema = z.uuid();
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((value) => value || null)
		.optional();

export const adminListSchema = z.object({
	pageIndex: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(100).default(10),
	search: z.string().trim().max(200).default(""),
	view: z.enum(["catalog", "trash"]).default("catalog"),
});

export const productLifecycleInputSchema = z.object({
	id: idSchema,
	expectedRevision: z.number().int().positive(),
});

export const productOrderInputSchema = z
	.object({
		ids: z.array(idSchema).min(2).max(1_000),
	})
	.superRefine((value, context) => {
		if (new Set(value.ids).size !== value.ids.length)
			context.addIssue({
				code: "custom",
				path: ["ids"],
				message: "Product order IDs must be unique",
			});
	});

export const inventoryImportSchema = z.object({
	componentId: idSchema,
	content: z.string().trim().min(1).max(100_000),
	note: optionalText(500),
});

export const inventoryListSchema = adminListSchema.extend({
	productId: idSchema,
	componentId: idSchema.optional(),
});

export const inventoryStatusInputSchema = z.object({
	id: idSchema,
	status: z.enum(["available", "disabled"]),
});

export const inventoryRevealSchema = sensitiveProofSchema.extend({
	id: idSchema,
});

export const inventoryExportSchema = sensitiveProofSchema.extend({
	componentId: idSchema.optional(),
	status: z.enum(stockEntryStatuses).optional(),
});

export const productMediaUploadSchema = z.object({
	productId: idSchema,
	contentType: z.enum([
		"image/avif",
		"image/gif",
		"image/jpeg",
		"image/png",
		"image/webp",
	]),
	base64: z.string().min(1).max(8_000_000),
	altText: z.string().trim().max(200).default(""),
	setAsCover: z.boolean().default(false),
});

export const productMediaIdSchema = z.object({ id: idSchema });

export const productMediaListSchema = z.object({ productId: idSchema });

export const productMediaOrderSchema = z
	.object({
		productId: idSchema,
		ids: z.array(idSchema).min(2).max(12),
	})
	.superRefine((value, context) => {
		if (new Set(value.ids).size !== value.ids.length)
			context.addIssue({
				code: "custom",
				path: ["ids"],
				message: "Product media IDs must be unique",
			});
	});

export const recordIdSchema = z.object({ id: idSchema });
