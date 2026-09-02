import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const webhookUrl = process.env.AUTOMATION_WEBHOOK_URL;
const webhookSecret = process.env.AUTOMATION_WEBHOOK_SECRET;
const repo = process.env.GITHUB_REPOSITORY || "GMWalletApp/gmshop-edge";

if (!(webhookUrl && webhookSecret)) {
	throw new Error(
		"AUTOMATION_WEBHOOK_URL and AUTOMATION_WEBHOOK_SECRET are required",
	);
}

const context = JSON.parse(readFileSync(".automation/context.json", "utf8"));
const triggerKind = process.env.GITHUB_EVENT_NAME || "unknown";
const isPullRequest =
	triggerKind === "pull_request_target" ||
	Boolean(context.trigger?.pullRequest) ||
	Boolean(context.trigger?.issue?.pullRequest);
const eventType = ["schedule", "workflow_dispatch"].includes(triggerKind)
	? "triage.repository"
	: isPullRequest
		? "triage.pull_request"
		: "triage.issue";
const dryRun = process.env.AUTOMATION_DRY_RUN === "true";

const payload = {
	routeId: "gmwalletapp-gmshop-edge-triage",
	eventType,
	repo,
	dryRun,
	source: "github-actions",
	trigger: {
		kind: triggerKind,
		eventName: triggerKind,
		eventAction: process.env.GITHUB_EVENT_ACTION || "",
	},
	context: dryRun ? { ...context, test: true } : context,
};

const rawBody = JSON.stringify(payload);
const signature = `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;

for (let attempt = 1; attempt <= 3; attempt++) {
	try {
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-webhook-signature-256": signature,
			},
			body: rawBody,
			signal: AbortSignal.timeout(30_000),
		});

		if (response.ok) {
			console.log(await response.text());
			process.exit(0);
		}

		const text = await response.text();
		if (response.status < 500 || attempt === 3) {
			throw new Error(`Webhook request failed: ${response.status} ${text}`);
		}
	} catch (error) {
		if (attempt === 3) throw error;
	}

	await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
}
