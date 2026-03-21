import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createJulesFixSession,
	deleteJulesSession,
	extractPatchArtifacts,
	listAllJulesActivities,
	resolveJulesSource,
	runJulesSessionWithRetry,
} from "../../clients/jules.js";
import { rebuildDriftFromIssueContext } from "../../core/orchestrator/orchestrator.js";
import { GitPatchApplyError, gitOps } from "../../infrastructure/git.js";
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
vi.mock("../../clients/github.js", () => ({
	addCommentReaction: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../clients/jules.js", () => ({
	createJulesFixSession: vi
		.fn()
		.mockResolvedValue({ name: "sessions/fix-123" }),
	deleteJulesSession: vi.fn().mockResolvedValue({}),
	extractPatchArtifacts: vi.fn().mockReturnValue([
		{
			activityName: "sessions/fix-123/activities/1",
			createTime: "2026-03-19T10:00:01.000Z",
			patch: "diff --git a/src/app.ts b/src/app.ts\n...",
		},
	]),
	listAllJulesActivities: vi.fn().mockResolvedValue([]),
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
vi.mock("../../infrastructure/git.js", () => ({
	GitPatchApplyError: class extends Error {
		readonly patchLabel: string;

		constructor(patchLabel: string, message: string) {
			super(message);
			this.patchLabel = patchLabel;
		}
	},
	gitOps: {
		applyPatchFile: vi.fn(),
		configureUser: vi.fn(),
		createBranch: vi.fn(),
		commitAll: vi.fn(),
		push: vi.fn(),
		regenerateLockfile: vi.fn(),
		restoreWorkingTree: vi.fn(),
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
		vi.mocked(gitOps.applyPatchFile).mockImplementation(() => undefined);
		vi.mocked(gitOps.regenerateLockfile).mockImplementation(() => undefined);
		vi.mocked(runJulesSessionWithRetry).mockImplementation(
			async (_apiKey, createSessionAttempt) =>
				createSessionAttempt({
					fetch: globalThis.fetch.bind(globalThis),
				} as any),
		);
	});

	it("applies patch artifacts, creates a PR, and cleans up the session on success", async () => {
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
		expect(listAllJulesActivities).toHaveBeenCalled();
		expect(extractPatchArtifacts).toHaveBeenCalled();
		expect(gitOps.applyPatchFile).toHaveBeenCalled();
		expect(gitOps.regenerateLockfile).toHaveBeenCalled();
		expect(gitOps.push).toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
	});

	it("restores the working tree and comments on patch failure", async () => {
		vi.mocked(gitOps.applyPatchFile).mockImplementation(() => {
			throw new GitPatchApplyError(
				"diff --git a/src/app.ts b/src/app.ts",
				"boom",
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

		expect(gitOps.restoreWorkingTree).not.toHaveBeenCalled();
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Patch diff --git a/src/app.ts b/src/app.ts"),
		);
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			"sessions/fix-123",
		);
	});

	it("restores the working tree and comments on lockfile regeneration failure", async () => {
		vi.mocked(gitOps.regenerateLockfile).mockImplementation(() => {
			throw new Error("pnpm install failed");
		});

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockIssueBody,
			mockIssueNumber,
			mockCommentId,
			coreFrameworks,
		);

		expect(gitOps.applyPatchFile).toHaveBeenCalled();
		expect(gitOps.restoreWorkingTree).toHaveBeenCalled();
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to regenerate lockfile"),
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
