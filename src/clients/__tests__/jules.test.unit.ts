import * as core from "@actions/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedDrift } from "../../types/drift.js";
import {
	createJulesAnalysisSession,
	createJulesFixSession,
	deleteJulesSession,
	extractPatchArtifacts,
	getJulesSession,
	listAllJulesActivities,
	listJulesSources,
	resolveJulesSource,
	runJulesSessionWithRetry,
	summarizeJulesSession,
	waitForJulesSession,
} from "../jules.js";

vi.mock("@actions/core", () => ({
	warning: vi.fn(),
}));

describe("Jules API Client", () => {
	const mockApiKey = "test-api-key";
	const mockSession = "sessions/123";
	const resolvedSource = {
		sourceName: "sources/github-owner-repo",
		defaultBranch: "main",
	};

	const mockDrift: AggregatedDrift = {
		dependencyName: "lodash",
		currentVersions: new Set(["1.0.0"]),
		latestVersion: "2.0.0",
		releaseNotes: "Critical security fix.",
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

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it("resolves the Jules source across paginated responses", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						sources: [],
						nextPageToken: "page-2",
					}),
				),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						sources: [
							{
								name: "sources/github-owner-repo",
								id: "github-owner-repo",
								githubRepo: {
									owner: "owner",
									repo: "repo",
									defaultBranch: { displayName: "develop" },
								},
							},
						],
					}),
				),
			});

		const source = await resolveJulesSource(mockApiKey, "owner", "repo", {
			fetch: mockFetch as any,
		});

		expect(source).toEqual({
			sourceName: "sources/github-owner-repo",
			defaultBranch: "develop",
		});
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("creates an analysis session with the resolved source", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify({ name: mockSession, state: "QUEUED" }),
				),
		});

		const result = await createJulesAnalysisSession(
			mockApiKey,
			resolvedSource,
			mockDrift,
			{ fetch: mockFetch as any },
		);

		expect(result.name).toBe(mockSession);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sessions",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining("sources/github-owner-repo"),
			}),
		);
	});

	it("creates a fix session in manual automation mode", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify({ name: mockSession, state: "QUEUED" }),
				),
		});

		await createJulesFixSession(mockApiKey, resolvedSource, mockDrift, {
			fetch: mockFetch as any,
		});

		const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(requestBody.automationMode).toBe("AUTOMATION_MODE_UNSPECIFIED");
		expect(requestBody.sourceContext.source).toBe("sources/github-owner-repo");
		expect(requestBody.prompt).toContain(
			"CRITICAL: DO NOT modify pnpm-lock.yaml or any lockfiles.",
		);
	});

	it("gets a session by name", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify({ name: mockSession, state: "COMPLETED" }),
				),
		});

		const result = await getJulesSession(mockApiKey, mockSession, {
			fetch: mockFetch as any,
		});

		expect(result.state).toBe("COMPLETED");
		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sessions/123",
			expect.anything(),
		);
	});

	it("lists sources with pagination params", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(JSON.stringify({ sources: [] })),
		});

		await listJulesSources(mockApiKey, 50, "next-token", {
			fetch: mockFetch as any,
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sources?pageSize=50&pageToken=next-token",
			expect.anything(),
		);
	});

	it("waits for a session to complete", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify({ name: mockSession, state: "COMPLETED" }),
				),
		});

		const session = await waitForJulesSession(mockApiKey, mockSession, {
			fetch: mockFetch as any,
		});

		expect(session.state).toBe("COMPLETED");
	});

	it("throws when a session fails", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: mockSession, state: "FAILED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								name: "sessions/123/activities/1",
								id: "1",
								createTime: "2026-03-19T10:00:00.000Z",
								originator: "agent",
								sessionFailed: { reason: "Patch generation failed" },
							},
						],
					}),
				),
			});

		await expect(
			waitForJulesSession(mockApiKey, mockSession, {
				fetch: mockFetch as any,
			}),
		).rejects.toThrow(/Patch generation failed/);
	});

	it("retries transient failed sessions by creating a fresh session", async () => {
		vi.useFakeTimers();

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/1", state: "QUEUED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/1", state: "FAILED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								name: "sessions/1/activities/1",
								id: "1",
								createTime: "2026-03-19T10:00:00.000Z",
								originator: "agent",
								sessionFailed: {
									reason:
										"Jules encountered an error when cloning the repo... HTTP 502 curl 22",
								},
							},
						],
					}),
				),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue("{}"),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/2", state: "QUEUED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/2", state: "COMPLETED" }),
					),
			});

		const sessionPromise = runJulesSessionWithRetry(
			mockApiKey,
			(deps) => createJulesFixSession(mockApiKey, resolvedSource, mockDrift, deps),
			{ fetch: mockFetch as any },
		);

		await vi.advanceTimersByTimeAsync(5_000);
		const result = await sessionPromise;

		expect(result.name).toBe("sessions/2");
		expect(mockFetch).toHaveBeenCalledWith(
			"https://jules.googleapis.com/v1alpha/sessions/1",
			expect.objectContaining({
				method: "DELETE",
			}),
		);
		expect(
			mockFetch.mock.calls.filter(
				([url, options]) =>
					url === "https://jules.googleapis.com/v1alpha/sessions" &&
					options?.method === "POST",
			),
		).toHaveLength(2);
		expect(core.warning).toHaveBeenCalledWith(
			expect.stringContaining("HTTP 502"),
		);
		expect(core.warning).not.toHaveBeenCalledWith(
			expect.stringContaining("cloning the repo"),
		);
	});

	it("does not retry non-transient failed sessions", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/1", state: "QUEUED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi
					.fn()
					.mockResolvedValue(
						JSON.stringify({ name: "sessions/1", state: "FAILED" }),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								name: "sessions/1/activities/1",
								id: "1",
								createTime: "2026-03-19T10:00:00.000Z",
								originator: "agent",
								sessionFailed: { reason: "invalid prompt" },
							},
						],
					}),
				),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue("{}"),
			});

		await expect(
			runJulesSessionWithRetry(
				mockApiKey,
				(deps) =>
					createJulesFixSession(mockApiKey, resolvedSource, mockDrift, deps),
				{ fetch: mockFetch as any },
			),
		).rejects.toThrow(/invalid prompt/);

		expect(
			mockFetch.mock.calls.filter(
				([url, options]) =>
					url === "https://jules.googleapis.com/v1alpha/sessions" &&
					options?.method === "POST",
			),
		).toHaveLength(1);
	});

	it("retries transient session creation failures up to the maximum attempts", async () => {
		vi.useFakeTimers();

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 502,
				text: vi.fn().mockResolvedValue("bad gateway"),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 502,
				text: vi.fn().mockResolvedValue("bad gateway"),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 502,
				text: vi.fn().mockResolvedValue("bad gateway"),
			});

		const sessionPromise = runJulesSessionWithRetry(
			mockApiKey,
			(deps) => createJulesFixSession(mockApiKey, resolvedSource, mockDrift, deps),
			{ fetch: mockFetch as any },
		);
		const rejection = expect(sessionPromise).rejects.toThrow(/502/);

		await vi.advanceTimersByTimeAsync(15_000);
		await rejection;
		expect(
			mockFetch.mock.calls.filter(
				([url, options]) =>
					url === "https://jules.googleapis.com/v1alpha/sessions" &&
					options?.method === "POST",
			),
		).toHaveLength(3);
	});

	it("sorts paginated activities by createTime", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								name: "sessions/123/activities/2",
								id: "2",
								createTime: "2026-03-19T10:00:02.000Z",
								originator: "agent",
							},
						],
						nextPageToken: "page-2",
					}),
				),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						activities: [
							{
								name: "sessions/123/activities/1",
								id: "1",
								createTime: "2026-03-19T10:00:01.000Z",
								originator: "agent",
								agentMessaged: { agentMessage: "Analysis" },
							},
						],
					}),
				),
			});

		const activities = await listAllJulesActivities(mockApiKey, mockSession, {
			fetch: mockFetch as any,
		});

		expect(activities[0]?.id).toBe("1");
		expect(activities[1]?.id).toBe("2");
	});

	it("extracts agent analysis markdown from sorted activities", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: vi.fn().mockResolvedValue(
				JSON.stringify({
					activities: [
						{
							name: "sessions/123/activities/1",
							id: "1",
							createTime: "2026-03-19T10:00:01.000Z",
							originator: "agent",
							agentMessaged: { agentMessage: "### Summary\nLooks good" },
						},
					],
				}),
			),
		});

		const summary = await summarizeJulesSession(mockApiKey, mockSession, {
			fetch: mockFetch as any,
		});

		expect(summary.activityCount).toBe(1);
		expect(summary.analysisMarkdown).toContain("Looks good");
	});

	it("extracts git patch artifacts from activities", () => {
		const patches = extractPatchArtifacts(mockSession, [
			{
				name: "sessions/123/activities/1",
				id: "1",
				createTime: "2026-03-19T10:00:01.000Z",
				originator: "agent",
				artifacts: [
					{
						changeSet: {
							source: "sources/github-owner-repo",
							gitPatch: {
								baseCommitId: "abc123",
								unidiffPatch: "diff --git a/src/file.ts b/src/file.ts\n...",
								suggestedCommitMessage: "fix: update file",
							},
						},
					},
				],
			},
		]);

		expect(patches).toHaveLength(1);
		expect(patches[0]?.patch).toContain("diff --git");
		expect(patches[0]?.suggestedCommitMessage).toBe("fix: update file");
	});

	it("deletes a session by name", async () => {
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
			}),
		);
	});
});
