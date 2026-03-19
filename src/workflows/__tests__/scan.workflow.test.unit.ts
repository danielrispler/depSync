import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportDriftAsIssue } from "../../clients/github.js";
import {
	createJulesAnalysisSession,
	deleteJulesSession,
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
	summarizeJulesSession: vi
		.fn()
		.mockResolvedValue({ activityCount: 1, signals: ["Scanning footprint"] }),
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
				usages: [
					{
						file: "/workspace/apps/web/src/index.tsx",
						importStatement: "import React from 'react';",
						usages: [],
					},
				],
			},
		],
	} as any;

	it("deletes scan-time Jules sessions after successful issue creation", async () => {
		vi.mocked(analyzeMonorepoDrift).mockResolvedValue([drift]);

		await handleScanWorkflow(
			"gh-token",
			"jules-key",
			"https://example.com",
			"secret",
			"/workspace",
			new Set(["react"]),
		);

		expect(createJulesAnalysisSession).toHaveBeenCalled();
		expect(reportDriftAsIssue).toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith("jules-key", "sessions/1");
		expect(sendNotification).toHaveBeenCalled();
	});

	it("deletes scan-time Jules sessions even if issue creation fails", async () => {
		vi.mocked(analyzeMonorepoDrift).mockResolvedValue([drift]);
		vi.mocked(reportDriftAsIssue).mockRejectedValueOnce(
			new Error("GitHub failed"),
		);

		await handleScanWorkflow(
			"gh-token",
			"jules-key",
			"https://example.com",
			"secret",
			"/workspace",
			new Set(["react"]),
		);

		expect(summarizeJulesSession).toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith("jules-key", "sessions/1");
	});
});
