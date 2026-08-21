import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";
import type { CloudflareBindings } from "#/server/runtime/cloudflare";
import { currentRuntimeEnv } from "#/server/runtime/context";

export function getCloudflareEnv(_request?: Request) {
	return currentRuntimeEnv() as CloudflareBindings;
}

export function getRuntimeEnv(_request?: Request) {
	return currentRuntimeEnv();
}

export function getEnv(): Env {
	return currentRuntimeEnv() as unknown as Env;
}

function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export function getDb(request?: Request) {
	const db = getRuntimeEnv(request).DB;
	if (!db) throw new Error('Runtime database binding "DB" is unavailable.');
	return createDb(db as D1Database);
}

export type AppDb = ReturnType<typeof createDb>;
