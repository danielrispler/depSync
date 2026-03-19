import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportDriftAsIssue } from "../github.js";

vi.mock("@actions/github", () => ({
	context: {
		repo: {
			owner: "test-owner",
			repo: "test-repo",
		},
	},
	getOctokit: vi.fn(),
}));

describe("reportDriftAsIssue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockToken = "test-token";
	const mockDrift = {
		dependencyName: "react",
		currentVersions: new Set(["17.0.0"]),
		latestVersion: "18.0.0",
		releaseNotes: "## Breaking Changes\n- New JSX Transform",
		driftWeight: 340,
		updateType: 0,
		affectedPackages: [
			{
				packageName: "web",
				packageJsonPath: "/workspace/apps/web/package.json",
			},
		],
		affectedSourceFiles: [
			{
				packageJsonPath: "/workspace/apps/web/package.json",
				filePath: "/workspace/apps/web/src/index.tsx",
			},
		],
		usageCount: 3,
		payloads: [
			{
				package: {
					packageName: "web",
					version: "1.0.0",
					packagePath: "/workspace/apps/web",
					serviceDescription: "Main web application",
				},
				update: {
					dependencyName: "react",
					currentVersion: "17.0.0",
					latestVersion: "18.0.0",
				},
				usages: [
					{
						file: "/workspace/apps/web/src/index.tsx",
						importStatement: "import React from 'react';",
						usages: [],
					},
				],
			},
		],
	} as any;

	const mockAnalysis = {
		riskLevel: "high",
		issueSummary: "react affects 1 package across 1 file with high risk.",
		executionMetadata: {
			generatedAt: "2026-03-19T12:00:00.000Z",
			affectedFileCount: 1,
			affectedPackageCount: 1,
			julesActivityCount: 2,
		},
		markdown: "### Summary\nreact is widespread.\n\n### Risk\nHigh.",
	} as const;

	it("should create a new issue if none exists", async () => {
		const mockOctokit = {
			rest: {
				issues: {
					listForRepo: vi.fn().mockResolvedValue({ data: [] }),
					create: vi
						.fn()
						.mockResolvedValue({ data: { number: 1, html_url: "issue-url" } }),
					update: vi.fn(),
				},
			},
		};

		const result = await reportDriftAsIssue(
			mockToken,
			mockDrift,
			mockAnalysis,
			{
				getOctokit: () => mockOctokit as any,
			},
		);

		expect(result).toEqual({ number: 1, url: "issue-url" });
		expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "[depSync] Dependency Update: react",
				body: expect.stringMatching(/<!-- depsync-context:/),
			}),
		);
		expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
	});

	it("should update an existing issue if one is found", async () => {
		const mockOctokit = {
			rest: {
				issues: {
					listForRepo: vi.fn().mockResolvedValue({
						data: [
							{
								title: "[depSync] Dependency Update: react",
								number: 42,
							},
						],
					}),
					create: vi.fn(),
					update: vi
						.fn()
						.mockResolvedValue({ data: { number: 42, html_url: "issue-url" } }),
				},
			},
		};

		await reportDriftAsIssue(mockToken, mockDrift, mockAnalysis, {
			getOctokit: () => mockOctokit as any,
		});

		expect(mockOctokit.rest.issues.update).toHaveBeenCalledWith(
			expect.objectContaining({
				issue_number: 42,
				body: expect.stringContaining("Affected Packages"),
			}),
		);
		expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
	});

	it("should keep the hidden payload compact and exclude raw release notes", async () => {
		const mockOctokit = {
			rest: {
				issues: {
					listForRepo: vi.fn().mockResolvedValue({ data: [] }),
					create: vi
						.fn()
						.mockResolvedValue({ data: { number: 1, html_url: "issue-url" } }),
					update: vi.fn(),
				},
			},
		};

		await reportDriftAsIssue(mockToken, mockDrift, mockAnalysis, {
			getOctokit: () => mockOctokit as any,
		});

		const body = mockOctokit.rest.issues.create.mock.calls[0][0].body as string;
		expect(body).toContain("Main web application");
		expect(body).not.toContain("New JSX Transform");
		expect(body).not.toContain("import React from 'react';");
		expect(body.length).toBeLessThan(10_000);
	});
});
