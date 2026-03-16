import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedDrift } from "../../types/drift.js";
import {
	createJulesSession,
	deleteJulesSession,
	sendJulesMessage,
} from "../jules.js";

describe("createJulesSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockApiKey = "test-api-key";
	const mockOwner = "owner";
	const mockRepo = "repo";
	const mockDrift: AggregatedDrift = {
		dependencyName: "lodash",
		currentVersions: new Set(["1.0.0"]),
		latestVersion: "2.0.0",
		releaseNotes: "Critical security fix for potential XSS vulnerability.",
		priorityScore: 50,
		payloads: [
			{
				package: {
					packageName: "test-pkg",
					version: "1.0.0",
					packagePath: "/test",
					serviceDescription: "Handles user auth",
				},
				update: {
					dependencyName: "lodash",
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
				},
				usages: [],
			},
		],
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
			mockDrift,
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
	});
});

describe("sendJulesMessage", () => {
	const mockApiKey = "test-api-key";
	const mockSession = "sessions/123";

	it("should return fixes when API returns them", async () => {
		const mockFixes = [
			{ filePath: "src/index.ts", fileContent: "new content" },
		];
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn().mockResolvedValue({ fixes: mockFixes }),
		});

		const result = await sendJulesMessage(mockApiKey, mockSession, "fix it", {
			fetch: mockFetch as any,
		});

		expect(result).toEqual(mockFixes);
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("sessions/123:sendMessage"),
			expect.objectContaining({ method: "POST" }),
		);
	});
});

describe("deleteJulesSession", () => {
	const mockApiKey = "test-api-key";
	const mockSession = "sessions/123";

	it("should call DELETE on the session URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
		});

		await deleteJulesSession(mockApiKey, mockSession, {
			fetch: mockFetch as any,
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sessions/123",
			expect.objectContaining({
				method: "DELETE",
				headers: { "x-goog-api-key": mockApiKey },
			}),
		);
	});

	it("should handle 404 gracefully", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		});

		await expect(
			deleteJulesSession(mockApiKey, mockSession, { fetch: mockFetch as any }),
		).resolves.not.toThrow();
	});
});
