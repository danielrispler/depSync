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
	summarizeJulesSession,
	waitForJulesSession,
} from "../jules.js";

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
