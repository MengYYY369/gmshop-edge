import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Label = { name?: string };
type Repository = {
	full_name: string;
	default_branch: string;
	html_url: string;
};
type IssueItem = {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	labels?: Label[];
	user?: { login?: string };
	created_at: string;
	updated_at: string;
	pull_request?: unknown;
};
type PullRequestItem = {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	draft: boolean;
	user?: { login?: string };
	base?: { ref?: string };
	head?: { ref?: string; repo?: { full_name?: string } };
	created_at: string;
	updated_at: string;
};

const token = process.env.GITHUB_TOKEN;
const eventName = process.env.GITHUB_EVENT_NAME || "unknown";
const eventPath = process.env.GITHUB_EVENT_PATH;
const repo = process.env.GITHUB_REPOSITORY;

if (!(token && repo)) {
	throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
}

const event =
	eventPath && existsSync(eventPath)
		? JSON.parse(readFileSync(eventPath, "utf8"))
		: {};

async function github(path: string) {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "project-automation",
		},
	});

	if (!response.ok) {
		throw new Error(
			`GitHub API ${path} failed: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

const [repository, issueItems, pullRequests] = (await Promise.all([
	github(`/repos/${repo}`),
	github(`/repos/${repo}/issues?state=open&per_page=100`),
	github(`/repos/${repo}/pulls?state=open&per_page=100`),
])) as [Repository, IssueItem[], PullRequestItem[]];

const triggerIssue = event.issue
	? {
			number: event.issue.number,
			title: event.issue.title,
			body: event.issue.body,
			url: event.issue.html_url,
			state: event.issue.state,
			labels: (event.issue.labels || [])
				.map((label: { name?: string }) => label.name)
				.filter(Boolean),
			user: event.issue.user?.login,
			pullRequest: Boolean(event.issue.pull_request),
		}
	: null;

const triggerPullRequest = event.pull_request
	? {
			number: event.pull_request.number,
			title: event.pull_request.title,
			body: event.pull_request.body,
			url: event.pull_request.html_url,
			state: event.pull_request.state,
			draft: event.pull_request.draft,
			user: event.pull_request.user?.login,
			base: event.pull_request.base?.ref,
			head: event.pull_request.head?.ref,
			headRepo: event.pull_request.head?.repo?.full_name,
		}
	: null;

const report = {
	generatedAt: new Date().toISOString(),
	eventName,
	repository: {
		name: repository.full_name,
		defaultBranch: repository.default_branch,
		url: repository.html_url,
	},
	trigger: {
		action: event.action ?? null,
		issue: triggerIssue,
		pullRequest: triggerPullRequest,
		comment: event.comment
			? {
					id: event.comment.id,
					body: event.comment.body,
					url: event.comment.html_url,
					user: event.comment.user?.login,
					createdAt: event.comment.created_at,
				}
			: null,
	},
	openIssues: issueItems
		.filter((issue) => !issue.pull_request)
		.map((issue) => ({
			number: issue.number,
			title: issue.title,
			body: issue.body,
			url: issue.html_url,
			labels: (issue.labels || [])
				.map((label: { name?: string }) => label.name)
				.filter(Boolean),
			user: issue.user?.login,
			createdAt: issue.created_at,
			updatedAt: issue.updated_at,
		})),
	openPullRequests: pullRequests.map((pullRequest) => ({
		number: pullRequest.number,
		title: pullRequest.title,
		body: pullRequest.body,
		url: pullRequest.html_url,
		draft: pullRequest.draft,
		user: pullRequest.user?.login,
		base: pullRequest.base?.ref,
		head: pullRequest.head?.ref,
		headRepo: pullRequest.head?.repo?.full_name,
		createdAt: pullRequest.created_at,
		updatedAt: pullRequest.updated_at,
	})),
};

mkdirSync(".automation", { recursive: true });
writeFileSync(
	".automation/context.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
