import * as fs from "node:fs";
import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createJulesFixSession,
	deleteJulesSession,
	sendJulesMessage,
} from "../../clients/jules.js";
import { rebuildDriftFromIssueContext } from "../../core/orchestrator/orchestrator.js";
import { gitOps } from "../../infrastructure/git.js";
import { handleFixCommand } from "../fix.command.js";

vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
	context: {
		repo: { owner: "owner", repo: "repo" },
	},
	getOctokit: vi.fn().mockReturnValue({
		rest: {
			issues: {
				createComment: vi.fn().mockResolvedValue({}),
			},
			pulls: {
				create: vi.fn().mockResolvedValue({ data: { number: 42 } }),
			},
		},
	}),
}));
vi.mock("node:fs");
vi.mock("../../clients/github.js", () => ({
	addCommentReaction: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../clients/jules.js", () => ({
	createJulesFixSession: vi
		.fn()
		.mockResolvedValue({ name: "sessions/fix-123" }),
	deleteJulesSession: vi.fn().mockResolvedValue({}),
	sendJulesMessage: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../core/orchestrator/orchestrator.js", () => ({
	rebuildDriftFromIssueContext: vi.fn().mockResolvedValue({
		dependencyName: "react",
		currentVersions: new Set(["17.0.0"]),
		latestVersion: "18.0.0",
		releaseNotes: "notes",
		driftWeight: 340,
		updateType: 0,
		affectedPackages: [],
		affectedSourceFiles: [],
		usageCount: 1,
		payloads: [],
	}),
}));
vi.mock("../../infrastructure/git.js", () => ({
	gitOps: {
		configureUser: vi.fn(),
		createBranch: vi.fn(),
		commitAll: vi.fn(),
		push: vi.fn(),
	},
}));

describe("handleFixCommand", () => {
	const mockGithubToken = "token";
	const mockJulesApiKey = "key";
	const mockIssueBody =
		'<!-- depsync-context: {"schemaVersion":1,"dependencyName":"react","currentVersions":["17.0.0"],"latestVersion":"18.0.0","affectedPackages":[{"packageName":"web","packageJsonPath":"/workspace/apps/web/package.json"}],"affectedSourceFiles":[{"packageJsonPath":"/workspace/apps/web/package.json","filePath":"/workspace/apps/web/src/index.tsx"}],"riskLevel":"high","issueSummary":"summary","executionMetadata":{"generatedAt":"2026-03-19T12:00:00.000Z","affectedFileCount":1,"affectedPackageCount":1}} -->';
	const mockIssueNumber = 1;
	const mockCommentId = 100;
	const coreFrameworks = new Set(["react"]);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should apply fixes, create a PR, and clean up the new session on success", async () => {
		vi.mocked(sendJulesMessage).mockResolvedValue([
			{ filePath: "src/app.ts", fileContent: "fixed" },
		]);

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockIssueBody,
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(rebuildDriftFromIssueContext).toHaveBeenCalled();
		expect(createJulesFixSession).toHaveBeenCalled();
		expect(fs.writeFileSync).toHaveBeenCalledWith("src/app.ts", "fixed");
		expect(gitOps.push).toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
	});

	it("should keep the issue open on failure but still clean up the new session", async () => {
		vi.mocked(sendJulesMessage).mockRejectedValue(new Error("Jules failed"));

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockIssueBody,
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed /fix flow: Jules failed"),
		);
	});

	it("should report malformed issue context and avoid session creation", async () => {
		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			"no context here",
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(createJulesFixSession).not.toHaveBeenCalled();
		expect(deleteJulesSession).not.toHaveBeenCalled();
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed /fix flow"),
		);
	});
});
