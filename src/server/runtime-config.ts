import { createSecretKeyring } from "#/lib/secrets";
import { loadRequestSettings } from "./request-settings";

const runtimeConfigKeys = {
	betterAuthSecret: "runtime.better_auth_secret",
	betterAuthUrl: "runtime.better_auth_url",
	automationCallbackSecret: "runtime.automation_callback_secret",
	dataEncryptionSecret: "runtime.data_encryption_secret",
} as const;

export type RuntimeConfig = {
	betterAuthSecret: string;
	betterAuthUrl: string;
	automationCallbackSecret: string;
	dataEncryptionSecret: string;
	authProviderSecret: string;
	commerceSecret: string;
	integrationConfigSecret: string;
};

const requestRuntimeConfig = new WeakMap<Request, Promise<RuntimeConfig>>();

export function loadRequestRuntimeConfig(
	request: Request,
	db: D1Database,
	origin = "",
) {
	const cached = requestRuntimeConfig.get(request);
	if (cached) return cached;
	const pending = loadRequestSettings(request, db).then((settings) =>
		runtimeConfigFromSettings(settings, origin),
	);
	requestRuntimeConfig.set(request, pending);
	return pending;
}

export async function loadRuntimeConfig(
	db: D1Database,
): Promise<RuntimeConfig> {
	const rows = await db
		.prepare(
			`SELECT key, value FROM system_settings
			 WHERE key IN (${Object.values(runtimeConfigKeys)
					.map(() => "?")
					.join(", ")})`,
		)
		.bind(...Object.values(runtimeConfigKeys))
		.all<{ key: string; value: string }>();
	return runtimeConfigFromSettings(
		new Map(rows.results.map((row) => [row.key, row.value])),
		"",
	);
}

function runtimeConfigFromSettings(
	settings: ReadonlyMap<string, string>,
	origin: string,
): RuntimeConfig {
	const stored = new Map(
		[...settings].map(([key, value]) => [key, parseString(value)]),
	);
	const dataEncryptionSecret =
		stored.get(runtimeConfigKeys.dataEncryptionSecret) ?? "";
	return {
		betterAuthSecret: stored.get(runtimeConfigKeys.betterAuthSecret) ?? "",
		betterAuthUrl: stored.get(runtimeConfigKeys.betterAuthUrl) ?? origin,
		automationCallbackSecret:
			stored.get(runtimeConfigKeys.automationCallbackSecret) ?? "",
		dataEncryptionSecret,
		authProviderSecret: dataEncryptionSecret,
		commerceSecret: dataEncryptionSecret,
		integrationConfigSecret: dataEncryptionSecret,
	};
}

export function createInitialRuntimeConfig(origin = ""): RuntimeConfig {
	const dataEncryptionSecret = createSecretKeyring();
	return {
		betterAuthSecret: generateRuntimeSecret(),
		betterAuthUrl: origin,
		automationCallbackSecret: generateRuntimeSecret(),
		dataEncryptionSecret,
		authProviderSecret: dataEncryptionSecret,
		commerceSecret: dataEncryptionSecret,
		integrationConfigSecret: dataEncryptionSecret,
	};
}

export function runtimeConfigEntries(config: RuntimeConfig) {
	return [
		{
			key: runtimeConfigKeys.betterAuthSecret,
			value: config.betterAuthSecret,
			isSecret: true,
		},
		{
			key: runtimeConfigKeys.betterAuthUrl,
			value: config.betterAuthUrl,
			isSecret: false,
		},
		{
			key: runtimeConfigKeys.automationCallbackSecret,
			value: config.automationCallbackSecret,
			isSecret: true,
		},
		{
			key: runtimeConfigKeys.dataEncryptionSecret,
			value: config.dataEncryptionSecret,
			isSecret: true,
		},
	];
}

function generateRuntimeSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function parseString(value: string) {
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "string" ? parsed : "";
	} catch {
		return "";
	}
}
