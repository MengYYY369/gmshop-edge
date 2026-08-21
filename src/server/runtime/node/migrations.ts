import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NodeDatabase } from "./database";

const MIGRATION_PATTERN = /^\d+_.+\.sql$/;

export type NodeMigration = {
	name: string;
	sql: string;
	checksum: string;
};

export async function loadNodeMigrations(
	directory: URL | string = new URL("../../../../drizzle/", import.meta.url),
): Promise<NodeMigration[]> {
	const files = (await readdir(directory))
		.filter((name) => MIGRATION_PATTERN.test(name))
		.sort();
	return Promise.all(
		files.map(async (name) => {
			const sql = await readFile(
				typeof directory === "string"
					? new URL(name, `file://${resolve(directory)}/`)
					: new URL(name, directory),
				"utf8",
			);
			return { name, sql, checksum: sha256(sql) };
		}),
	);
}

export async function applyNodeMigrations(
	database: NodeDatabase,
	directory: URL | string = new URL("../../../../drizzle/", import.meta.url),
) {
	const migrations = await loadNodeMigrations(directory);
	const knownNames = new Set(migrations.map(({ name }) => name));

	const apply = database.sqlite.transaction(() => {
		database.sqlite.exec(`CREATE TABLE IF NOT EXISTS node_migrations (
			name TEXT PRIMARY KEY NOT NULL,
			checksum TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)`);
		const record = database.sqlite.prepare(
			"INSERT INTO node_migrations (name, checksum, applied_at) VALUES (?, ?, ?)",
		);
		const appliedRows = database.sqlite
			.prepare("SELECT name, checksum FROM node_migrations")
			.all() as Array<{ name: string; checksum: string }>;
		const unknown = appliedRows.filter(({ name }) => !knownNames.has(name));
		if (unknown.length > 0)
			throw new Error(
				`Database contains unknown migrations: ${unknown.map(({ name }) => name).join(", ")}`,
			);
		const appliedChecksums = new Map(
			appliedRows.map(({ name, checksum }) => [name, checksum]),
		);
		let appliedCount = 0;
		for (const migration of migrations) {
			const existingChecksum = appliedChecksums.get(migration.name);
			if (existingChecksum) {
				if (existingChecksum !== migration.checksum)
					throw new Error(`Applied migration changed: ${migration.name}`);
				continue;
			}
			for (const statement of splitMigration(migration.sql)) {
				if (isForeignKeysPragma(statement)) continue;
				database.sqlite.exec(statement);
			}
			record.run(migration.name, migration.checksum, Date.now());
			appliedCount += 1;
		}
		const foreignKeyViolations = database.sqlite.pragma(
			"foreign_key_check",
		) as unknown[];
		if (foreignKeyViolations.length > 0)
			throw new Error(
				`Migration foreign-key check failed (${foreignKeyViolations.length} violation(s))`,
			);
		return appliedCount;
	});

	const foreignKeysEnabled =
		database.sqlite.pragma("foreign_keys", { simple: true }) === 1;
	if (foreignKeysEnabled) database.sqlite.pragma("foreign_keys = OFF");
	try {
		return { applied: apply(), total: migrations.length };
	} finally {
		if (foreignKeysEnabled) database.sqlite.pragma("foreign_keys = ON");
	}
}

function splitMigration(sql: string) {
	return sql
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter(Boolean);
}

function isForeignKeysPragma(statement: string) {
	return /^PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;?$/iu.test(statement);
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
