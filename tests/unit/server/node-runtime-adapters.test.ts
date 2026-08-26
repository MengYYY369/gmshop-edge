import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeMemoryCache } from "#/server/runtime/node/cache";
import { openNodeDatabase } from "#/server/runtime/node/database";
import { NodeRuntimeLifecycle } from "#/server/runtime/node/lifecycle";
import { applyNodeMigrations } from "#/server/runtime/node/migrations";
import { NodeObjectStorage } from "#/server/runtime/node/object-storage";
import { NodeDurableQueue } from "#/server/runtime/node/queue";
import { NodeScheduler } from "#/server/runtime/node/scheduler";

const directories: string[] = [];

afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Bun SQLite database", () => {
	it("implements D1-style statements and atomic batches", async () => {
		const database = openNodeDatabase(":memory:");
		await database.exec(
			"CREATE TABLE values_table (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)",
		);
		const inserted = await database
			.prepare("INSERT INTO values_table (value) VALUES (?)")
			.bind("one")
			.run();
		expect(inserted.meta.changes).toBe(1);
		expect(
			await database
				.prepare("SELECT value FROM values_table WHERE id = ?")
				.bind(1)
				.first<string>("value"),
		).toBe("one");

		await expect(
			database.batch([
				database.prepare("INSERT INTO values_table (value) VALUES ('two')"),
				database.prepare("INSERT INTO values_table (value) VALUES ('one')"),
			]),
		).rejects.toThrow();
		const count = await database
			.prepare("SELECT COUNT(*) AS count FROM values_table")
			.first<number>("count");
		expect(count).toBe(1);
		database.close();
	});

	it("applies each immutable migration exactly once", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "0000_initial.sql"),
			"CREATE TABLE example (id TEXT PRIMARY KEY);",
		);
		const database = openNodeDatabase(":memory:");
		const url = pathToFileURL(`${directory}/`);
		expect(await applyNodeMigrations(database, url)).toEqual({
			applied: 1,
			total: 1,
		});
		expect(await applyNodeMigrations(database, url)).toEqual({
			applied: 0,
			total: 1,
		});
		await writeFile(
			join(directory, "0000_initial.sql"),
			"CREATE TABLE changed (id TEXT PRIMARY KEY);",
		);
		await expect(applyNodeMigrations(database, url)).rejects.toThrow(
			"Applied migration changed",
		);
		database.close();
	});

	it("applies rebuild migrations atomically with populated foreign keys", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "0000_initial.sql"),
			`CREATE TABLE parent (id TEXT PRIMARY KEY);--> statement-breakpoint
			 CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id));`,
		);
		const database = openNodeDatabase(":memory:");
		await applyNodeMigrations(database, directory);
		database.sqlite.run("INSERT INTO parent VALUES ('parent-1')");
		database.sqlite.run("INSERT INTO child VALUES ('child-1', 'parent-1')");
		await writeFile(
			join(directory, "0001_rebuild.sql"),
			`PRAGMA foreign_keys=OFF;--> statement-breakpoint
			 CREATE TABLE new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '');--> statement-breakpoint
			 INSERT INTO new_parent (id) SELECT id FROM parent;--> statement-breakpoint
			 DROP TABLE parent;--> statement-breakpoint
			 ALTER TABLE new_parent RENAME TO parent;--> statement-breakpoint
			 PRAGMA foreign_keys=ON;`,
		);

		await expect(applyNodeMigrations(database, directory)).resolves.toEqual({
			applied: 1,
			total: 2,
		});
		expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
			[],
		);
		expect(
			(
				database.sqlite.prepare("SELECT label FROM parent").get() as {
					label: string;
				}
			).label,
		).toBe("");
		database.close();
	});

	it("rejects data created by an unknown future migration", async () => {
		const directory = await temporaryDirectory();
		await writeFile(
			join(directory, "0000_initial.sql"),
			"CREATE TABLE example (id TEXT PRIMARY KEY);",
		);
		const database = openNodeDatabase(":memory:");
		await applyNodeMigrations(database, directory);
		database.sqlite
			.prepare(
				"INSERT INTO node_migrations (name, checksum, applied_at) VALUES (?, ?, ?)",
			)
			.run("9999_future.sql", "future", Date.now());

		await expect(applyNodeMigrations(database, directory)).rejects.toThrow(
			"unknown migrations",
		);
		database.close();
	});
});

describe("NodeMemoryCache", () => {
	it("expires entries and evicts the least recently used value", async () => {
		let now = 1_000;
		const cache = new NodeMemoryCache({ maxEntries: 2, now: () => now });
		await cache.put("expiring", "value", { expirationTtl: 1 });
		now = 2_000;
		expect(await cache.get("expiring")).toBeNull();

		await cache.put("one", "1");
		await cache.put("two", "2");
		expect(await cache.get("one")).toBe("1");
		await cache.put("three", "3");
		expect(await cache.get("two")).toBeNull();
		expect(await cache.get("one")).toBe("1");
	});

	it("bounds retained cache data by bytes", async () => {
		const cache = new NodeMemoryCache({ maxEntries: 10, maxBytes: 3 });
		await cache.put("one", "12");
		await cache.put("two", "34");
		expect(await cache.get("one")).toBeNull();
		expect(await cache.get("two")).toBe("34");

		await cache.put("oversized", "1234");
		expect(await cache.get("oversized")).toBeNull();
	});
});

describe("NodeObjectStorage", () => {
	it("streams private objects with metadata and safe hashed paths", async () => {
		const directory = await temporaryDirectory();
		const storage = new NodeObjectStorage(directory);
		const stored = await storage.put("../../order/download", "asset", {
			httpMetadata: { contentType: "text/plain", cacheControl: "private" },
			customMetadata: { orderId: "order-1" },
		});
		expect(stored?.etag).toMatch(/^[a-f0-9]{64}$/);
		await expect(
			readFile(join(directory, "order", "download")),
		).rejects.toMatchObject({ code: "ENOENT" });

		const object = await storage.get("../../order/download");
		expect(object && "body" in object ? await object.text() : null).toBe(
			"asset",
		);
		const headers = new Headers();
		object?.writeHttpMetadata(headers);
		expect(headers.get("content-type")).toBe("text/plain");

		const conditional = await storage.get("../../order/download", {
			onlyIf: new Headers({ "if-none-match": stored?.httpEtag ?? "" }),
		});
		expect(conditional && "body" in conditional).toBe(false);
		await storage.delete("../../order/download");
		expect(await storage.head("../../order/download")).toBeNull();
	});
});

describe("Node durable background services", () => {
	it("reuses queue statements instead of preparing them per operation", async () => {
		const database = openNodeDatabase(":memory:");
		const queue = new NodeDurableQueue<{ id: string }>(database, "commerce");
		const statements = Reflect.get(queue, "statements") as {
			insert: { run: (...values: unknown[]) => unknown };
			selectCandidates: { all: (...values: unknown[]) => unknown };
			claim: { get: (...values: unknown[]) => unknown };
			retry: { run: (...values: unknown[]) => unknown };
			ack: { run: (...values: unknown[]) => unknown };
		};
		const insert = vi.spyOn(statements.insert, "run");
		const selectCandidates = vi.spyOn(statements.selectCandidates, "all");
		const claim = vi.spyOn(statements.claim, "get");
		const retry = vi.spyOn(statements.retry, "run");
		const ack = vi.spyOn(statements.ack, "run");

		await queue.send({ id: "order-1" });
		const [claimed] = queue.claim(1, 1_000, Date.now());
		if (!claimed) throw new Error("Expected a claimed message");
		queue.retry(claimed, {
			maxAttempts: 2,
			delayMs: 0,
			now: Date.now(),
		});
		const [retried] = queue.claim(1, 1_000, Date.now());
		if (!retried) throw new Error("Expected a retried message");
		queue.ack(retried.id, retried.lease_token);

		expect(insert).toHaveBeenCalledOnce();
		expect(selectCandidates).toHaveBeenCalledTimes(2);
		expect(claim).toHaveBeenCalledTimes(2);
		expect(retry).toHaveBeenCalledOnce();
		expect(ack).toHaveBeenCalledOnce();
		database.close();
	});

	it("backs off empty polling and wakes immediately when a message arrives", async () => {
		vi.useFakeTimers();
		const database = openNodeDatabase(":memory:");
		const queue = new NodeDurableQueue<{ id: string }>(database, "commerce");
		const claim = vi.spyOn(queue, "claim");
		const handled: string[] = [];
		const consumer = queue.createConsumer(
			async (batch) => {
				handled.push(batch.messages[0]?.body.id ?? "missing");
				batch.ackAll();
			},
			{
				concurrency: 1,
				maxAttempts: 3,
				pollIntervalMs: 100,
				maxIdlePollIntervalMs: 400,
			},
		);

		consumer.start();
		await advanceTimersByTime(0);
		expect(claim).toHaveBeenCalledTimes(1);
		await advanceTimersByTime(299);
		expect(claim).toHaveBeenCalledTimes(2);
		await advanceTimersByTime(1);
		expect(claim).toHaveBeenCalledTimes(3);

		await queue.send({ id: "order-1" });
		await advanceTimersByTime(0);
		expect(handled).toEqual(["order-1"]);
		await queue.sendBatch([{ body: { id: "order-2" } }]);
		await advanceTimersByTime(0);
		expect(handled).toEqual(["order-1", "order-2"]);

		await consumer.stop();
		database.close();
	});

	it("leases, retries and dead-letters persistent queue messages", async () => {
		const directory = await temporaryDirectory();
		const filename = join(directory, "queue.sqlite");
		const database = openNodeDatabase(filename);
		const queue = new NodeDurableQueue<{ id: string }>(database, "commerce");
		await queue.send({ id: "order-1" });
		database.close();

		const reopened = openNodeDatabase(filename);
		const recoveredQueue = new NodeDurableQueue<{ id: string }>(
			reopened,
			"commerce",
		);
		const [claimed] = recoveredQueue.claim(1, 1_000, Date.now());
		expect(claimed && JSON.parse(claimed.body)).toEqual({ id: "order-1" });
		if (!claimed) throw new Error("Expected a claimed message");
		recoveredQueue.retry(claimed, {
			maxAttempts: 1,
			delayMs: 15_000,
			now: Date.now(),
			error: "Error",
		});
		const state = reopened.sqlite
			.prepare(
				"SELECT status, last_error FROM node_queue_messages WHERE id = ?",
			)
			.get(claimed.id);
		expect(state).toEqual({ status: "dead", last_error: "Error" });
		reopened.close();
	});

	it("dead-letters malformed persisted messages", async () => {
		vi.useFakeTimers();
		const database = openNodeDatabase(":memory:");
		const queue = new NodeDurableQueue<{ id: string }>(database, "commerce");
		await queue.send({ id: "order-1" });
		database.sqlite
			.prepare("UPDATE node_queue_messages SET body = ?")
			.run("not-json");
		const handler = vi.fn();
		const consumer = queue.createConsumer(handler, {
			concurrency: 1,
			maxAttempts: 1,
		});

		consumer.start();
		await advanceTimersByTime(0);
		const row = database.sqlite
			.prepare("SELECT status, last_error FROM node_queue_messages")
			.get();
		expect(row).toEqual({ status: "dead", last_error: "SyntaxError" });
		expect(handler).not.toHaveBeenCalled();
		await consumer.stop();
		database.close();
	});

	it("does not poll while every consumer slot is occupied", async () => {
		vi.useFakeTimers();
		const database = openNodeDatabase(":memory:");
		const queue = new NodeDurableQueue<{ id: string }>(database, "commerce");
		await queue.sendBatch([
			{ body: { id: "order-1" } },
			{ body: { id: "order-2" } },
		]);
		const claim = vi.spyOn(queue, "claim");
		let release: (() => void) | undefined;
		const handled: string[] = [];
		const consumer = queue.createConsumer(
			async (batch) => {
				handled.push(batch.messages[0]?.body.id ?? "missing");
				if (handled.length === 1)
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				batch.ackAll();
			},
			{ concurrency: 1, maxAttempts: 2, pollIntervalMs: 100 },
		);

		consumer.start();
		await advanceTimersByTime(0);
		await advanceTimersByTime(1_000);
		expect(claim).toHaveBeenCalledTimes(1);
		release?.();
		await flushMicrotasks();
		await advanceTimersByTime(0);
		expect(handled).toHaveLength(2);
		expect(new Set(handled)).toEqual(new Set(["order-1", "order-2"]));
		await consumer.stop();
		database.close();
	});

	it("prevents overlapping schedules and stops services in reverse order", async () => {
		vi.useFakeTimers();
		let resolveTask: (() => void) | undefined;
		const task = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveTask = resolve;
				}),
		);
		const scheduler = new NodeScheduler(task, { intervalMs: 1_000 });
		scheduler.start();
		await advanceTimersByTime(2_000);
		expect(task).toHaveBeenCalledTimes(1);
		resolveTask?.();
		await scheduler.stop();

		const calls: string[] = [];
		const lifecycle = new NodeRuntimeLifecycle([
			{
				start: () => {
					calls.push("start:first");
				},
				stop: () => {
					calls.push("stop:first");
				},
			},
			{
				start: () => {
					calls.push("start:second");
				},
				stop: () => {
					calls.push("stop:second");
				},
			},
		]);
		await lifecycle.start();
		await lifecycle.stop();
		expect(calls).toEqual([
			"start:first",
			"start:second",
			"stop:second",
			"stop:first",
		]);
	});
});

async function advanceTimersByTime(durationMs: number) {
	vi.advanceTimersByTime(durationMs);
	await flushMicrotasks();
}

async function flushMicrotasks() {
	for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), "gmshop-node-runtime-"));
	directories.push(directory);
	return directory;
}
