import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createJulesFixSession,
	deleteJulesSession,
	extractPullRequestOutput,
	resolveJulesSource,
	runJulesSessionWithRetry,
} from "../../clients/jules.js";
import { rebuildDriftFromIssueContext } from "../../core/orchestrator/orchestrator.js";
import { handleFixCommand } from "../fix.command.js";

const { mockCreateComment } = vi.hoisted(() => ({
	mockCreateComment: vi.fn().mockResolvedValue({}),
}));

vi.mock("@actions/core");
vi.mock("@actions/github", () => ({
	context: {
		repo: { owner: "owner", repo: "repo" },
	},
	getOctokit: vi.fn().mockReturnValue({
		rest: {
			issues: {
				createComment: mockCreateComment,
			},
		},
	}),
}));
vi.mock("../../clients/github.js", () => ({
	addCommentReaction: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../clients/jules.js", () => ({
	createJulesFixSession: vi
		.fn()
		.mockResolvedValue({ name: "sessions/fix-123" }),
	deleteJulesSession: vi.fn().mockResolvedValue({}),
	extractPullRequestOutput: vi.fn().mockReturnValue({
		url: "https://github.com/owner/repo/pull/42",
		title: "[depSync] Fix for Issue #1",
		description: "Closes #1",
	}),
	resolveJulesSource: vi.fn().mockResolvedValue({
		sourceName: "sources/github-owner-repo",
		defaultBranch: "main",
	}),
	runJulesSessionWithRetry: vi
		.fn()
		.mockResolvedValue({ name: "sessions/fix-123", state: "COMPLETED" }),
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
		vi.mocked(runJulesSessionWithRetry).mockImplementation(
			async (_apiKey, createSessionAttempt) =>
				({
					...(await createSessionAttempt({
						fetch: globalThis.fetch.bind(globalThis),
					} as any)),
					state: "COMPLETED",
				}) as any,
		);
	});

	it("reports the natively exported PR and cleans up the session on success", async () => {
		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockIssueBody,
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(rebuildDriftFromIssueContext).toHaveBeenCalled();
		expect(resolveJulesSource).toHaveBeenCalled();
		expect(runJulesSessionWithRetry).toHaveBeenCalled();
		expect(createJulesFixSession).toHaveBeenCalled();
		expect(extractPullRequestOutput).toHaveBeenCalled();
		expect(mockCreateComment).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				body: expect.stringContaining("https://github.com/owner/repo/pull/42"),
			}),
		);
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
	});

	it("comments on missing PR output and still cleans up the session", async () => {
		vi.mocked(extractPullRequestOutput).mockImplementation(() => {
			throw new Error(
				"No pull request output was found for Jules session sessions/fix-123.",
			);
		});

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockIssueBody,
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("No pull request output was found"),
		);
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
	});

	it("reports malformed issue context and avoids session creation", async () => {
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
