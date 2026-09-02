import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
	".github/workflows/project-automation.yml",
	"utf8",
);
const release = readFileSync(".github/workflows/release.yml", "utf8");

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("project automation workflow contract", () => {
	test("handles repository scans, issues, comments, and pull requests", () => {
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain('cron: "0 */6 * * *"');
		expect(workflow).toContain("issues:");
		expect(workflow).toContain("issue_comment:");
		expect(workflow).toContain("pull_request_target:");
		expect(workflow).toContain(
			"types: [opened, edited, synchronize, reopened, ready_for_review]",
		);
	});

	test("checks out only the trusted default branch with read-only permissions", () => {
		expect(workflow).toContain("contents: read");
		expect(workflow).toContain("issues: read");
		expect(workflow).toContain("pull-requests: read");
		expect(workflow).toContain(
			"ref: $" + "{{ github.event.repository.default_branch }}",
		);
		expect(workflow).not.toContain("github.event.pull_request.head");
	});

	test("uses a provider-neutral signed webhook contract", () => {
		expect(workflow).toContain("AUTOMATION_WEBHOOK_URL");
		expect(workflow).toContain("AUTOMATION_WEBHOOK_SECRET");
		expect(workflow).toContain("AUTOMATION_DRY_RUN");
		expect(workflow).toContain("bun run scripts/project-automation-context.ts");
		expect(workflow).toContain("bun run scripts/project-automation-webhook.ts");
		expect(workflow).not.toMatch(/hermes|openclaw|bridge/i);
	});

	test("runs this contract before dispatch", () => {
		expect(workflow).toContain(
			"bun test scripts/project-automation-workflow.test.ts",
		);
		expect(
			workflow.indexOf("bun test scripts/project-automation-workflow.test.ts"),
		).toBeLessThan(
			workflow.indexOf("bun run scripts/project-automation-webhook.ts"),
		);
	});

	test("automation-only commits do not trigger a release", () => {
		expect(release).toContain("paths-ignore:");
		expect(release).toContain("- '.github/**'");
		expect(release).toContain("- 'scripts/project-automation-*.ts'");
		expect(count(release, "workflow_dispatch:")).toBe(1);
	});
});
