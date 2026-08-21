import type { RuntimeEnv } from "#/server/runtime/types";

export type CloudflareBindings = {
	DB?: D1Database;
	FILES?: R2Bucket;
	CACHE?: KVNamespace;
	COMMERCE_QUEUE?: Queue;
	EMAIL?: SendEmail;
};

export function adaptCloudflareEnv(
	bindings: CloudflareBindings,
	waitUntil?: (promise: Promise<unknown>) => void,
): RuntimeEnv {
	const database = bindings.DB as RuntimeEnv["DB"];
	return {
		runtime: "cloudflare",
		DB: database,
		FILES: bindings.FILES as RuntimeEnv["FILES"],
		CACHE: bindings.CACHE as RuntimeEnv["CACHE"],
		COMMERCE_QUEUE: bindings.COMMERCE_QUEUE as RuntimeEnv["COMMERCE_QUEUE"],
		EMAIL: bindings.EMAIL,
		waitUntil,
	};
}
