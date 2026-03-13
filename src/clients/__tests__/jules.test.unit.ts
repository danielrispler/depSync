import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiPromptPayload } from "../../core/orchestrator/orchestrator.utils.js";
import { createJulesSession } from "../jules.js";

describe("createJulesSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockApiKey = "test-api-key";
	const mockOwner = "owner";
	const mockRepo = "repo";
	const mockDep = "lodash";
	const mockPayload: GeminiPromptPayload = {
		package: {
			packageName: "test-pkg",
			version: "1.0.0",
			packagePath: "/test",
			readmeContent: null,
		},
		update: {
			dependencyName: "lodash",
			currentVersion: "1.0.0",
			latestVersion: "2.0.0",
		},
		usages: [],
	};

	it("should call the Jules API with correct headers and body", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn().mockResolvedValue({ name: "sessions/123" }),
		});

		const result = await createJulesSession(
			mockApiKey,
			mockOwner,
			mockRepo,
			mockDep,
			mockPayload,
			{ fetch: mockFetch as any },
		);

		expect(result.name).toBe("sessions/123");
		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sessions",
			expect.objectContaining({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": mockApiKey,
				},
			}),
		);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.sourceContext.source).toBe("sources/github-owner-repo");
		expect(body.prompt).toContain("Analyze this AST context");
	});

	it("should throw a specific error on 429 rate limit", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
		});

		await expect(
			createJulesSession(
				mockApiKey,
				mockOwner,
				mockRepo,
				mockDep,
				mockPayload,
				{
					fetch: mockFetch as any,
				},
			),
		).rejects.toThrow(/rate limit exceeded/);
	});

	it("should throw an error with response text on other non-ok status codes", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: vi.fn().mockResolvedValue("Internal Server Error"),
		});

		await expect(
			createJulesSession(
				mockApiKey,
				mockOwner,
				mockRepo,
				mockDep,
				mockPayload,
				{
					fetch: mockFetch as any,
				},
			),
		).rejects.toThrow(/status 500/);
	});
});
