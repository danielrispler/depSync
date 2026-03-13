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
		payloads: [
			{
				package: { packageName: "web", version: "1.0.0" },
				update: { currentVersion: "17.0.0", latestVersion: "18.0.0" },
				usages: [{}, {}],
			},
		],
	} as any;

	const mockJulesSession = {
		name: "sessions/123",
		title: "depSync: Update react",
	} as any;

	it("should create a new issue if none exists", async () => {
		const mockOctokit = {
			rest: {
				issues: {
					listForRepo: vi.fn().mockResolvedValue({ data: [] }),
					create: vi.fn().mockResolvedValue({ data: { number: 1 } }),
					update: vi.fn(),
				},
			},
		};

		await reportDriftAsIssue(mockToken, mockDrift, mockJulesSession, {
			getOctokit: () => mockOctokit as any,
		});

		expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "[depSync] Dependency Update: react",
				body: expect.stringMatching(/<!-- jules-session-id: sessions\/123 -->/),
			}),
		);
		expect(mockOctokit.rest.issues.update).not.toHaveBeenCalled();
	});

	it("should update an existing issue if one is found", async () => {
		const mockOctokit = {
			rest: {
				issues: {
					listForRepo: vi.fn().mockResolvedValue({
						data: [{ title: "[depSync] Dependency Update: react", number: 42 }],
					}),
					create: vi.fn(),
					update: vi.fn().mockResolvedValue({ data: {} }),
				},
			},
		};

		await reportDriftAsIssue(mockToken, mockDrift, mockJulesSession, {
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
});
