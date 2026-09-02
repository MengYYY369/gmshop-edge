import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

describe("wallet incremental migration", () => {
	let miniflare: Miniflare | undefined;

	afterEach(async () => miniflare?.dispose());

	it("preserves existing users while initializing their balances", async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: crypto.randomUUID() },
		});
		const database = await miniflare.getD1Database("DB");
		for (const name of [
			"0000_gmshop.sql",
			"0001_telegram_bot_support.sql",
			"0002_glamorous_pete_wisdom.sql",
			"0003_product_tag_names.sql",
		])
			await applySql(database, name);
		await database
			.prepare(
				"INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('user-1', 'Existing', 'existing@example.com', 1, 1)",
			)
			.run();
		await applySql(database, "0004_plain_prima.sql");
		const user = await database
			.prepare(
				"SELECT name, email, balance_minor, balance_version FROM users WHERE id = 'user-1'",
			)
			.first<Record<string, unknown>>();
		expect(user).toEqual({
			name: "Existing",
			email: "existing@example.com",
			balance_minor: "0",
			balance_version: 1,
		});
		expect(
			(await database.prepare("PRAGMA foreign_key_check").all()).results,
		).toEqual([]);
	});
});

async function applySql(database: D1Database, name: string) {
	const source = await readFile(
		new URL(`../../drizzle/${name}`, import.meta.url),
		"utf8",
	);
	const statements = source
		.split("--> statement-breakpoint")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((statement) => database.prepare(statement));
	await database.batch(statements);
}
