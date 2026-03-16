import * as fs from "node:fs";
import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeIssue } from "../../clients/github.js";
import { deleteJulesSession, sendJulesMessage } from "../../clients/jules.js";
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
	closeIssue: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../clients/jules.js", () => ({
	deleteJulesSession: vi.fn().mockResolvedValue({}),
	sendJulesMessage: vi.fn().mockResolvedValue([]),
	getJulesSession: vi.fn().mockResolvedValue({}),
	listJulesActivities: vi.fn().mockResolvedValue({ activities: [] }),
}));
vi.mock("../../clients/notifier.js", () => ({
	sendNotification: vi.fn().mockResolvedValue({}),
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
	const mockSessionName = "sessions/123";
	const mockIssueNumber = 1;
	const mockCommentId = 100;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should apply fixes, create PR, and close issue on success", async () => {
		vi.mocked(sendJulesMessage).mockResolvedValue([
			{ filePath: "src/app.ts", fileContent: "fixed" },
		]);

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockSessionName,
			mockIssueNumber,
			mockCommentId,
			undefined,
		);

		expect(fs.writeFileSync).toHaveBeenCalledWith("src/app.ts", "fixed");
		expect(gitOps.push).toHaveBeenCalled();
		expect(closeIssue).toHaveBeenCalledWith(mockGithubToken, mockIssueNumber);
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			mockSessionName,
		);
	});

	it("should NOT close issue on failure but still cleanup session", async () => {
		vi.mocked(sendJulesMessage).mockRejectedValue(new Error("Jules failed"));

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockSessionName,
			mockIssueNumber,
			mockCommentId,
			undefined,
		);

		expect(closeIssue).not.toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			mockSessionName,
		);
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed /fix flow: Jules failed"),
		);
	});

	it("should fail if no fixes are returned and keep issue open", async () => {
		vi.mocked(sendJulesMessage).mockResolvedValue([]);

		await handleFixCommand(
			mockGithubToken,
			mockJulesApiKey,
			mockSessionName,
			mockIssueNumber,
			mockCommentId,
			undefined,
		);

		expect(closeIssue).not.toHaveBeenCalled();
		expect(deleteJulesSession).toHaveBeenCalledWith(
			mockJulesApiKey,
			mockSessionName,
		);
		expect(core.error).toHaveBeenCalledWith(
			expect.stringContaining("Jules AI did not return any file fixes"),
		);
	});
});
