import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchReleaseNotes,
	getReleaseNotesForDependency,
	resolveGitHubRepo,
} from "../changelog.js";

describe("resolveGitHubRepo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should resolve owner/repo from a standard repository.url object", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				repository: {
					type: "git",
					url: "git+https://github.com/facebook/react.git",
				},
			}),
		});

		const result = await resolveGitHubRepo("react", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toEqual({ owner: "facebook", repo: "react" });
	});

	it("should resolve owner/repo from a plain string repository field", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				repository: "https://github.com/lodash/lodash.git",
			}),
		});

		const result = await resolveGitHubRepo("lodash", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toEqual({ owner: "lodash", repo: "lodash" });
	});

	it("should return null when no repository field exists", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		});

		const result = await resolveGitHubRepo("no-repo-pkg", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toBeNull();
	});

	it("should return null when the registry responds with non-ok status", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		});

		const result = await resolveGitHubRepo("not-found-pkg", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toBeNull();
	});

	it("should handle git:// protocol URLs", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				repository: {
					type: "git",
					url: "git://github.com/expressjs/express.git",
				},
			}),
		});

		const result = await resolveGitHubRepo("express", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toEqual({ owner: "expressjs", repo: "express" });
	});
});

describe("fetchReleaseNotes", () => {
	it("should return release body for v-prefixed tag", async () => {
		const mockOctokit = {
			rest: {
				repos: {
					getReleaseByTag: vi.fn().mockResolvedValue({
						data: { body: "## Breaking Changes\n- Removed X" },
					}),
				},
			},
		};

		const result = await fetchReleaseNotes("token", "owner", "repo", "2.0.0", {
			fetch: vi.fn() as any,
			getOctokit: () => mockOctokit as any,
		});

		expect(result).toBe("## Breaking Changes\n- Removed X");
		expect(mockOctokit.rest.repos.getReleaseByTag).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			tag: "v2.0.0",
		});
	});

	it("should fallback to non-prefixed tag when v-prefix fails", async () => {
		const mockOctokit = {
			rest: {
				repos: {
					getReleaseByTag: vi
						.fn()
						.mockRejectedValueOnce(new Error("Not Found"))
						.mockResolvedValueOnce({
							data: { body: "Migration guide here" },
						}),
				},
			},
		};

		const result = await fetchReleaseNotes("token", "owner", "repo", "3.0.0", {
			fetch: vi.fn() as any,
			getOctokit: () => mockOctokit as any,
		});

		expect(result).toBe("Migration guide here");
		expect(mockOctokit.rest.repos.getReleaseByTag).toHaveBeenCalledTimes(2);
	});

	it("should return null when no tag is found", async () => {
		const mockOctokit = {
			rest: {
				repos: {
					getReleaseByTag: vi.fn().mockRejectedValue(new Error("Not Found")),
				},
			},
		};

		const result = await fetchReleaseNotes("token", "owner", "repo", "1.0.0", {
			fetch: vi.fn() as any,
			getOctokit: () => mockOctokit as any,
		});

		expect(result).toBeNull();
	});
});

describe("getReleaseNotesForDependency", () => {
	it("should return truncated release notes when exceeding 3000 chars", async () => {
		const longBody = "x".repeat(4000);
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				repository: {
					type: "git",
					url: "git+https://github.com/org/pkg.git",
				},
			}),
		});

		const mockOctokit = {
			rest: {
				repos: {
					getReleaseByTag: vi.fn().mockResolvedValue({
						data: { body: longBody },
					}),
				},
			},
		};

		const result = await getReleaseNotesForDependency("token", "pkg", "1.0.0", {
			fetch: mockFetch as typeof fetch,
			getOctokit: () => mockOctokit as any,
		});

		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThan(longBody.length);
		expect(result).toContain("...[RELEASE NOTES TRUNCATED BY DEPSYNC]");
	});

	it("should return null gracefully on any error", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("Network failure"));

		const result = await getReleaseNotesForDependency("token", "pkg", "1.0.0", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toBeNull();
	});

	it("should return null when repo cannot be resolved", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		});

		const result = await getReleaseNotesForDependency("token", "pkg", "1.0.0", {
			fetch: mockFetch as typeof fetch,
			getOctokit: vi.fn() as any,
		});

		expect(result).toBeNull();
	});
});
