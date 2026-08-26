import { z } from "zod";
import { sensitiveProofSchema } from "#/features/auth/reauthentication-schema";

export const supplierApiKeyCreateSchema = sensitiveProofSchema.extend({
	name: z.string().trim().min(1).max(100),
});

export const supplierApiKeyIdSchema = z.object({ id: z.uuid() });
