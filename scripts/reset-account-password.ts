// Emergency account password reset runbook (replaces the removed
// /api/emergency-reset-password HTTP backdoor).
//
// Usage:
//   bun run scripts/reset-account-password.ts <email> <newPassword> [--remote --yes]
//
// Default target is the LOCAL D1 database. To reset a password in the
// production database you must pass both --remote and --yes. The security
// boundary is your Cloudflare account credentials (wrangler auth), not a
// public URL.
//
// What it does, mirroring Better Auth's own storage layout:
//   1. Look up the user by normalized email.
//   2. Hash the new password with better-auth/crypto's hashPassword so the
//      result is verifiable by Better Auth as-is.
//   3. Update the credential account's password (or create one if missing).
//   4. Delete all sessions of that user so re-login is forced.
//
// After resetting a root admin password, log in through the admin panel and
// set a fresh password there as soon as possible.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";

const databaseName = "gmshop-edge";
const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const scriptArgs = process.argv.slice(2);
const remote = scriptArgs.includes("--remote");
const confirmed = scriptArgs.includes("--yes");
const positional = scriptArgs.filter((arg) => !arg.startsWith("--"));
const email = positional[0]?.trim().toLowerCase();
const newPassword = positional[1];

if (!email || !newPassword) {
	console.error(
		"Usage: bun run scripts/reset-account-password.ts <email> <newPassword> [--remote --yes]",
	);
	process.exit(1);
}

if (remote && !confirmed) {
	console.error(
		"Refusing to touch the production database without explicit consent.\n" +
			"Re-run with both --remote and --yes to reset a password in production D1.",
	);
	process.exit(1);
}

type QueryRow = Record<string, unknown>;

async function runWrangler(args: string[]) {
	return new Promise<string>((resolve, reject) => {
		const child = spawn("bunx", ["wrangler", ...args], {
			cwd: projectDirectory,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 60_000,
		});
		const stdout: Uint8Array[] = [];
		const stderr: Uint8Array[] = [];
		child.stdout?.on("data", (chunk: Uint8Array) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Uint8Array) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			const out = Buffer.concat(stdout).toString("utf8");
			const err = Buffer.concat(stderr).toString("utf8");
			if (code === 0) return resolve(out);
			reject(
				new Error(`wrangler ${args.join(" ")} exited with ${code}\n${err}`),
			);
		});
	});
}

function targetFlags() {
	return remote ? ["--remote"] : ["--local"];
}

async function queryRows(command: string): Promise<QueryRow[]> {
	const output = await runWrangler([
		"d1",
		"execute",
		databaseName,
		...targetFlags(),
		"--json",
		"--command",
		command,
	]);
	const result = JSON.parse(output) as Array<{ results?: QueryRow[] }>;
	return result.flatMap((entry) => entry.results ?? []);
}

async function executeSql(command: string) {
	await runWrangler([
		"d1",
		"execute",
		databaseName,
		...targetFlags(),
		"--command",
		command,
	]);
}

function q(value: string | number) {
	if (typeof value === "number") return String(value);
	return `'${value.replaceAll("'", "''")}'`;
}

const target = remote ? "PRODUCTION" : "local";
console.log(`Target: ${target} D1 (${databaseName})`);

const users = await queryRows(
	`SELECT id, email FROM users WHERE email = ${q(email)} LIMIT 1`,
);
const user = users[0];
if (!user || typeof user.id !== "string") {
	console.error(`No user found for email ${email}. Nothing was changed.`);
	process.exit(1);
}
const userId = user.id;

const passwordHash = await hashPassword(newPassword);
const now = Date.now().toString();

const existingAccounts = await queryRows(
	`SELECT id FROM accounts WHERE user_id = ${q(userId)} AND provider_id = 'credential' LIMIT 1`,
);
if (existingAccounts[0] && typeof existingAccounts[0].id === "string") {
	await executeSql(
		`UPDATE accounts SET password = ${q(passwordHash)}, updated_at = ${q(now)} WHERE id = ${q(existingAccounts[0].id as string)}`,
	);
	console.log("Updated existing credential account password.");
} else {
	await executeSql(
		`INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (${q(randomUUID())}, ${q(userId)}, 'credential', ${q(userId)}, ${q(passwordHash)}, ${q(now)}, ${q(now)})`,
	);
	console.log("Created credential account (user previously had none).");
}

await executeSql(`DELETE FROM sessions WHERE user_id = ${q(userId)}`);
console.log("Cleared all sessions for the user.");
console.log(
	"Done. The user can now sign in with the new password. If this was a root admin,\n" +
		"set a fresh password from the admin panel afterwards.",
);
