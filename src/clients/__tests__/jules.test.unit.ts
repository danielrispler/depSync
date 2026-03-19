import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedDrift } from "../../types/drift.js";
import {
	approveJulesPlan,
	createJulesAnalysisSession,
	createJulesFixSession,
	deleteJulesSession,
	getJulesSession,
	listJulesActivities,
	listJulesSources,
	sendJulesMessage,
	summarizeJulesSession,
} from "../jules.js";

describe("Jules API Client", () => {
	const mockApiKey = "test-api-key";
	const mockSession = "sessions/123";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createJulesAnalysisSession", () => {
		const mockOwner = "owner";
		const mockRepo = "repo";
		const mockDrift: AggregatedDrift = {
			dependencyName: "lodash",
			currentVersions: new Set(["1.0.0"]),
			latestVersion: "2.0.0",
			releaseNotes: "Critical security fix for potential XSS vulnerability.",
			driftWeight: 340,
			updateType: 0,
			affectedPackages: [],
			affectedSourceFiles: [],
			usageCount: 0,
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
				text: vi.fn().mockResolvedValue(JSON.stringify({ name: mockSession })),
			});

			const result = await createJulesAnalysisSession(
				mockApiKey,
				mockOwner,
				mockRepo,
				mockDrift,
				{ fetch: mockFetch as any },
			);

			expect(result.name).toBe(mockSession);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://jules.googleapis.com/v1alpha/sessions",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Goog-Api-Key": mockApiKey,
					},
				}),
			);
		});
	});

	describe("createJulesFixSession", () => {
		it("should create a fix-oriented session", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(JSON.stringify({ name: mockSession })),
			});

			const drift = {
				dependencyName: "react",
				currentVersions: new Set(["18.0.0"]),
				latestVersion: "19.0.0",
				releaseNotes: null,
				driftWeight: 340,
				updateType: 0,
				affectedPackages: [],
				affectedSourceFiles: [],
				usageCount: 1,
				payloads: [],
			} as AggregatedDrift;

			await createJulesFixSession(mockApiKey, "owner", "repo", drift, {
				fetch: mockFetch as any,
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://jules.googleapis.com/v1alpha/sessions",
				expect.objectContaining({
					method: "POST",
				}),
			);
		});
	});

	describe("sendJulesMessage", () => {
		it("should call the sendMessage endpoint with prompt and return fixes", async () => {
			const mockFetch = vi.fn().mockImplementation((url) => {
				if (url.endsWith(":sendMessage")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						text: vi.fn().mockResolvedValue("{}"),
					});
				}
				if (url.includes("/activities")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						text: vi.fn().mockResolvedValue(
							JSON.stringify({
								activities: [
									{
										artifacts: [
											{
												path: "src/index.ts",
												contents: "console.log('fixed');",
											},
										],
									},
								],
							}),
						),
					});
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					text: vi
						.fn()
						.mockResolvedValue(JSON.stringify({ name: mockSession })),
				});
			});

			const fixes = await sendJulesMessage(mockApiKey, mockSession, "fix it", {
				fetch: mockFetch as any,
			});

			expect(fixes).toHaveLength(1);
			expect(fixes[0]).toEqual({
				filePath: "src/index.ts",
				fileContent: "console.log('fixed');",
			});
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("sessions/123:sendMessage"),
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ prompt: "fix it" }),
				}),
			);
		});
	});

	describe("approveJulesPlan", () => {
		it("should call the approvePlan endpoint", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue("{}"),
			});

			await approveJulesPlan(mockApiKey, mockSession, {
				fetch: mockFetch as any,
			});

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("sessions/123:approvePlan"),
				expect.objectContaining({
					method: "POST",
				}),
			);
		});
	});

	describe("getJulesSession", () => {
		it("should call the session URL with GET", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(JSON.stringify({ name: mockSession })),
			});

			const result = await getJulesSession(mockApiKey, mockSession, {
				fetch: mockFetch as any,
			});

			expect(result.name).toBe(mockSession);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://jules.googleapis.com/v1alpha/sessions/123",
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Goog-Api-Key": mockApiKey,
					}),
				}),
			);
		});
	});

	describe("listJulesActivities", () => {
		it("should call the activities URL with GET", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(JSON.stringify({ activities: [] })),
			});

			const result = await listJulesActivities(mockApiKey, mockSession, 30, {
				fetch: mockFetch as any,
			});

			expect(result.activities).toEqual([]);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("sessions/123/activities?pageSize=30"),
				expect.anything(),
			);
		});
	});

	describe("summarizeJulesSession", () => {
		it("should collect progress and plan titles from activities", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								progressUpdated: {
									title: "Scanning footprint",
									description: "Found risky imports",
								},
								planGenerated: {
									plan: {
										id: "plan-1",
										steps: [{ id: "step-1", title: "Update adapters" }],
									},
								},
							},
						],
					}),
				),
			});

			const summary = await summarizeJulesSession(mockApiKey, mockSession, {
				fetch: mockFetch as any,
			});

			expect(summary.activityCount).toBe(1);
			expect(summary.signals).toContain("Scanning footprint");
			expect(summary.signals).toContain("Found risky imports");
			expect(summary.signals).toContain("Update adapters");
		});
	});

	describe("listJulesSources", () => {
		it("should call the sources URL with GET", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(JSON.stringify({ sources: [] })),
			});

			const result = await listJulesSources(mockApiKey, {
				fetch: mockFetch as any,
			});

			expect(result.sources).toEqual([]);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://jules.googleapis.com/v1alpha/sources",
				expect.anything(),
			);
		});
	});

	describe("deleteJulesSession", () => {
		it("should call DELETE on the session URL", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue("{}"),
			});

			await deleteJulesSession(mockApiKey, mockSession, {
				fetch: mockFetch as any,
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"https://jules.googleapis.com/v1alpha/sessions/123",
				expect.objectContaining({
					method: "DELETE",
					headers: { "X-Goog-Api-Key": mockApiKey },
				}),
			);
		});

		it("should handle 404 gracefully", async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
			});

			await expect(
				deleteJulesSession(mockApiKey, mockSession, {
					fetch: mockFetch as any,
				}),
			).resolves.not.toThrow();
		});
	});
});
