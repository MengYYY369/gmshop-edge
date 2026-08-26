import { z } from "zod";
import { isSafeWebhookUrl } from "#/lib/webhook-url";

export const buildProviders = ["github_actions", "gitlab_ci"] as const;

const keySchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z][A-Za-z0-9_]*$/);

const methodSchema = z
	.object({
		key: keySchema,
		name: z.string().trim().min(1).max(120),
		description: z.string().trim().max(500).default(""),
		runtime: z.string().trim().min(1).max(120),
		branch: z.string().trim().max(255).default(""),
		command: z.string().trim().max(2_000).default(""),
		artifactPolicy: z
			.enum(["none", "optional", "required"])
			.default("required"),
		outputPattern: z.string().trim().max(500).default(""),
		sortOrder: z.number().int().min(0).max(1_000_000).default(100),
		enabled: z.boolean().default(true),
	})
	.superRefine((value, context) => {
		if (value.artifactPolicy !== "none" && !value.outputPattern)
			context.addIssue({
				code: "custom",
				path: ["outputPattern"],
				message: "Artifact pattern is required when artifacts are accepted",
			});
		if (value.artifactPolicy === "none" && value.outputPattern)
			context.addIssue({
				code: "custom",
				path: ["outputPattern"],
				message: "Artifact pattern must be empty when artifacts are disabled",
			});
	});

const optionSchema = z.object({
	value: z.string().trim().min(1).max(200),
	label: z.string().trim().min(1).max(200),
});

const definitionSchema = z
	.object({
		key: keySchema,
		name: z.string().trim().min(1).max(120),
		description: z.string().trim().max(500).default(""),
		inputType: z.enum(["text", "number", "boolean", "select", "multiselect"]),
		scope: z.enum(["authorization", "automation", "order"]),
		required: z.boolean().default(false),
		sensitive: z.boolean().default(false),
		validationPattern: z
			.string()
			.trim()
			.max(200)
			.refine(isSafeValidationPattern)
			.default(""),
		minimumValue: z.number().int().nullable().default(null),
		maximumValue: z.number().int().nullable().default(null),
		defaultValue: z.string().max(2_000).default(""),
		exampleValue: z.string().max(2_000).default(""),
		sortOrder: z.number().int().min(0).max(1_000_000).default(100),
		options: z.array(optionSchema).max(100).default([]),
	})
	.superRefine((value, context) => {
		if (
			value.minimumValue !== null &&
			value.maximumValue !== null &&
			value.maximumValue < value.minimumValue
		)
			context.addIssue({
				code: "custom",
				path: ["maximumValue"],
				message: "Maximum value must not be below minimum value",
			});
		if (
			(value.inputType === "select" || value.inputType === "multiselect") &&
			value.options.length === 0
		)
			context.addIssue({
				code: "custom",
				path: ["options"],
				message: "Select inputs require options",
			});
	});

export const buildDefinitionListSchema = z.array(definitionSchema).max(50);

export const saveBuildConfigurationSchema = z
	.object({
		id: z.uuid().optional(),
		productId: z.uuid(),
		deliveryComponentId: z.uuid(),
		provider: z.enum(buildProviders),
		baseUrl: z.url().max(500),
		repositoryOwner: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/),
		repositoryName: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.regex(/^[A-Za-z0-9_.-]+$/),
		defaultBranch: z.string().trim().min(1).max(255),
		workflowFile: z
			.string()
			.trim()
			.min(1)
			.max(255)
			.refine(
				(value) =>
					!value.includes("..") &&
					(value.endsWith(".yml") || value.endsWith(".yaml")),
			),
		credential: z.string().trim().max(1_000).default(""),
		enabled: z.boolean(),
		methods: z.array(methodSchema).min(1).max(20),
		definitions: buildDefinitionListSchema,
	})
	.superRefine((value, context) => {
		const url = new URL(value.baseUrl);
		if (url.protocol !== "https:" || !isSafeWebhookUrl(value.baseUrl))
			context.addIssue({
				code: "custom",
				path: ["baseUrl"],
				message: "Build provider URL must be a safe public HTTPS URL",
			});
	});

export const buildConfigurationProductSchema = z.object({
	productId: z.uuid(),
	deliveryComponentId: z.uuid().optional(),
	id: z.uuid().optional(),
});

export const buildConfigurationListSchema = z
	.object({ productId: z.uuid().optional() })
	.default({});

export const buildConfigurationIdSchema = z.object({
	id: z.uuid(),
});

const buildInputValueSchema = z.union([
	z.string().max(10_000),
	z.number().int(),
	z.boolean(),
	z.array(z.string().max(1_000)).max(100),
]);

export const createBuildJobSchema = z.object({
	orderNumber: z.string().trim().min(8).max(80),
	entitlementId: z.uuid(),
	methodId: z.uuid(),
	idempotencyKey: z.string().trim().min(8).max(200),
	notificationChannel: z.enum(["none", "email"]).default("none"),
	authorizationValues: z.record(z.string(), buildInputValueSchema).default({}),
	automationValues: z.record(z.string(), buildInputValueSchema).default({}),
});

function isSafeValidationPattern(value: string) {
	if (!value) return true;
	if (/[(){}|\\][1-9]?/.test(value)) return false;
	try {
		new RegExp(value, "u");
		return true;
	} catch {
		return false;
	}
}
