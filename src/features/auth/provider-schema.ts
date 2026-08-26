import { z } from "zod";
import { authProviderAllowedScopes } from "#/features/auth/provider-presets";

export const authProviderTypes = ["email", "social"] as const;

const authProviderRecordIdSchema = z.union([
	z.uuid(),
	z.literal("auth-provider-credential"),
]);

export const builtInSocialProviderIds = [
	"apple",
	"discord",
	"github",
	"google",
	"line",
	"microsoft",
	"telegram",
	"wechat",
] as const;

export const authProviderInputSchema = z
	.object({
		id: authProviderRecordIdSchema.optional(),
		providerId: z
			.string()
			.trim()
			.toLowerCase()
			.regex(/^[a-z][a-z0-9_-]{1,63}$/),
		providerType: z.enum(authProviderTypes),
		displayName: z.string().trim().min(1).max(80),
		icon: z.string().trim().max(160).nullable().optional(),
		clientId: z.string().trim().max(500).nullable().optional(),
		clientSecret: z.string().min(1).max(2_000).optional(),
		clearClientSecret: z.boolean().default(false),
		telegramMiniAppEnabled: z.boolean().default(false),
		telegramBotToken: z
			.string()
			.trim()
			.regex(/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/)
			.optional(),
		clearTelegramBotToken: z.boolean().default(false),
		scopes: z
			.array(z.string().trim().min(1).max(100))
			.max(20)
			.transform((values) => [...new Set(values)]),
		allowSignup: z.boolean().default(true),
		passwordLoginEnabled: z.boolean().default(true),
		emailOtpEnabled: z.boolean().default(false),
		enabled: z.boolean().default(false),
		sortOrder: z.number().int().min(0).max(1_000_000).default(100),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.providerType === "social" &&
			!builtInSocialProviderIds.includes(
				value.providerId as (typeof builtInSocialProviderIds)[number],
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["providerId"],
				message: "Unsupported built-in social provider",
			});
		}
		if (value.providerType === "social" && value.providerId === "telegram") {
			if (!value.scopes.includes("openid"))
				context.addIssue({
					code: "custom",
					path: ["scopes"],
					message: "Telegram login requires the openid scope",
				});
		}
		if (value.providerType === "social") {
			const allowed =
				authProviderAllowedScopes[
					value.providerId as keyof typeof authProviderAllowedScopes
				];
			for (const [index, scope] of value.scopes.entries())
				if (!allowed?.includes(scope as never))
					context.addIssue({
						code: "custom",
						path: ["scopes", index],
						message: "Unsupported scope for authentication provider preset",
					});
		}
		if (value.providerType === "email" && value.providerId !== "credential") {
			context.addIssue({
				code: "custom",
				path: ["providerId"],
				message: "Email authentication uses the credential provider ID",
			});
		}
		if (
			value.providerType === "email" &&
			value.enabled &&
			!value.passwordLoginEnabled &&
			!value.emailOtpEnabled
		) {
			context.addIssue({
				code: "custom",
				path: ["passwordLoginEnabled"],
				message: "Enable password login or verification code login",
			});
		}
		if (value.clearClientSecret && value.clientSecret) {
			context.addIssue({
				code: "custom",
				path: ["clientSecret"],
				message: "A secret cannot be replaced and cleared together",
			});
		}
		if (value.clearTelegramBotToken && value.telegramBotToken) {
			context.addIssue({
				code: "custom",
				path: ["telegramBotToken"],
				message: "A Telegram bot token cannot be replaced and cleared together",
			});
		}
		if (value.providerId !== "telegram") {
			if (
				value.telegramMiniAppEnabled ||
				value.telegramBotToken ||
				value.clearTelegramBotToken
			)
				context.addIssue({
					code: "custom",
					path: ["telegramMiniAppEnabled"],
					message: "Mini App authentication is only available for Telegram",
				});
		}
	});

export const authProviderIdSchema = z.object({
	id: authProviderRecordIdSchema,
});

export const authProviderEnabledSchema = authProviderIdSchema.extend({
	enabled: z.boolean(),
});

export const authProviderOrderSchema = z.object({
	ids: z
		.array(authProviderRecordIdSchema)
		.min(1)
		.max(20)
		.refine((ids) => new Set(ids).size === ids.length),
});

export type AuthProviderInput = z.infer<typeof authProviderInputSchema>;
