import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportDriftAsIssue } from "../../clients/github.js";
import {
	createJulesAnalysisSession,
	deleteJulesSession,
	resolveJulesSource,
	runJulesSessionWithRetry,
	summarizeJulesSession,
} from "../../clients/jules.js";
import { sendNotification } from "../../clients/notifier.js";
import { analyzeMonorepoDrift } from "../../core/orchestrator/orchestrator.js";
import { handleScanWorkflow } from "../scan.workflow.js";

vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
	context: {
		repo: { owner: "owner", repo: "repo" },
	},
}));
vi.mock("../../clients/github.js", () => ({
	reportDriftAsIssue: vi
		.fn()
		.mockResolvedValue({ number: 1, url: "issue-url" }),
}));
vi.mock("../../clients/jules.js", () => ({
	createJulesAnalysisSession: vi.fn().mockResolvedValue({ name: "sessions/1" }),
	deleteJulesSession: vi.fn().mockResolvedValue(undefined),
	resolveJulesSource: vi.fn().mockResolvedValue({
		sourceName: "sources/github-owner-repo",
		defaultBranch: "main",
	}),
	runJulesSessionWithRetry: vi.fn(),
	summarizeJulesSession: vi.fn().mockResolvedValue({
		activityCount: 1,
		analysisMarkdown: "### Summary\nLooks good",
	}),
}));
vi.mock("../../clients/notifier.js", () => ({
	sendNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../core/orchestrator/orchestrator.js", () => ({
	analyzeMonorepoDrift: vi.fn().mockResolvedValue([]),
}));

describe("handleScanWorkflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(runJulesSessionWithRetry).mockImplementation(
			async (_apiKey, createSessionAttempt) =>
				createSessionAttempt({ fetch: globalThis.fetch.bind(globalThis) } as any),
		);
	});

	const drift = {
		dependencyName: "react",
		currentVersions: new Set(["18.0.0"]),
		latestVersion: "19.0.0",
		releaseNotes: "Breaking changes",
		driftWeight: 340,
		updateType: 0,
		affectedPackages: [
			{
				packageName: "web",
				packageJsonPath: "/workspace/apps/web/package.json",
			},
		],
		affectedSourceFiles: [
			{
				packageJsonPath: "/workspace/apps/web/package.json",
				filePath: "/workspace/apps/web/src/index.tsx",
			},
		],
		usageCount: 1,
		payloads: [
			{
				package: {
					packageName: "web",
					version: "1.0.0",
					packagePath: "/workspace/apps/web",
					serviceDescription: "Main app",
				},
				update: {
					dependencyName: "react",
					currentVersion: "18.0.0",
					latestVersion: "19.0.0",
				},
				usages: [],
			},
		],
	} as const;

	it("resolves the source once and processes drifts concurrently", async () => {
		vi.mocked(analyzeMonorepoDrift).mockResolvedValue([
			drift,
			{ ...drift, dependencyName: "vitest" } as any,
		]);
		vi.mocked(createJulesAnalysisSession)
			.mockResolvedValueOnce({ name: "sessions/1" } as any)
			.mockResolvedValueOnce({ name: "sessions/2" } as any);

		await handleScanWorkflow(
			"gh-token",
			"jules-key",
			"https://example.com",
			"secret",
			"/workspace",
			new Set(["react"]),
		);

		expect(resolveJulesSource).toHaveBeenCalledTimes(1);
		expect(runJulesSessionWithRetry).toHaveBeenCalledTimes(2);
		expect(createJulesAnalysisSession).toHaveBeenCalledTimes(2);
		expect(summarizeJulesSession).toHaveBeenCalledTimes(2);
		expect(sendNotification).toHaveBeenCalled();
	});

	it("deletes each session even when one worker fails", async () => {
		vi.mocked(analyzeMonorepoDrift).mockResolvedValue([
			drift,
			{ ...drift, dependencyName: "vitest" } as any,
		]);
		vi.mocked(createJulesAnalysisSession)
			.mockResolvedValueOnce({ name: "sessions/1" } as any)
			.mockResolvedValueOnce({ name: "sessions/2" } as any);
		vi.mocked(reportDriftAsIssue)
			.mockResolvedValueOnce({ number: 1, url: "issue-url-1" })
			.mockRejectedValueOnce(new Error("GitHub failed"));

		await handleScanWorkflow(
			"gh-token",
			"jules-key",
			"https://example.com",
			"secret",
			"/workspace",
			new Set(["react"]),
		);

		expect(deleteJulesSession).toHaveBeenCalledWith("jules-key", "sessions/1");
		expect(deleteJulesSession).toHaveBeenCalledWith("jules-key", "sessions/2");
	});
});
