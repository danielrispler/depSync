import { describe, expect, it, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { run } from "../index.js";
import { deleteJulesSession } from "../clients/jules.js";
import { addCommentReaction, closeIssue } from "../clients/github.js";

vi.mock("@actions/core");
vi.mock("@actions/github");
vi.mock("../clients/jules.js");
vi.mock("../clients/github.js");
vi.mock("node:child_process");
vi.mock("node:fs");

const setMockContext = (eventName: string, payload: any) => {
    Object.defineProperty(github, 'context', {
        value: {
            eventName,
            payload,
            repo: { owner: "owner", repo: "repo" },
            actor: "actor"
        },
        configurable: true
    });
};

describe("ChatOps Logic in index.ts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GITHUB_WORKSPACE = "/test/workspace";

        // Default mock implementation for inputs
        vi.mocked(core.getInput).mockImplementation((name) => {
            if (name === "github-token") return "fake-token";
            if (name === "jules-api-key") return "fake-key";
            return "";
        });
    });

    it("should ignore comments without ChatOps commands", async () => {
        setMockContext("issue_comment", {
            comment: { body: "Hello world", id: 1 },
            issue: { number: 123 }
        });

        await run();

        expect(core.info).toHaveBeenCalledWith(expect.stringContaining("Ignoring"));
    });

    it("should block unauthorized users for /fix command", async () => {
        setMockContext("issue_comment", {
            comment: { body: "/fix", id: 1, author_association: "NONE" },
            issue: { number: 123, body: "<!-- jules-session-id: sessions/123 -->" }
        });

        const mockOctokit = {
            rest: {
                issues: {
                    createComment: vi.fn().mockResolvedValue({})
                }
            }
        };
        vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as any);

        await run();

        expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("unauthorized"));
        expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it("should process /close command for authorized users", async () => {
        setMockContext("issue_comment", {
            comment: { body: "/close", id: 1, author_association: "OWNER" },
            issue: { number: 123, body: "<!-- jules-session-id: sessions/123 -->" }
        });

        await run();

        expect(addCommentReaction).toHaveBeenCalledWith(expect.any(String), 1, "rocket");
        expect(deleteJulesSession).toHaveBeenCalledWith(expect.any(String), "sessions/123");
        expect(closeIssue).toHaveBeenCalledWith(expect.any(String), 123);
    });

    it("should trigger cleanup when an issue is closed manually", async () => {
        setMockContext("issues", {
            action: "closed",
            issue: { body: "<!-- jules-session-id: sessions/999 -->" }
        });

        await run();

        expect(deleteJulesSession).toHaveBeenCalledWith(expect.any(String), "sessions/999");
    });
});
