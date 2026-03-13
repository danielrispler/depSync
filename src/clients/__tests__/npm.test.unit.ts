import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestVersion, isUpdateNeeded } from "../npm.js";

describe("getLatestVersion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return the latest version from the npm registry dist-tags", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				name: "vitest",
				"dist-tags": { latest: "4.0.18" },
			}),
		});

		const result = await getLatestVersion("vitest", {
			fetch: mockFetch as typeof fetch,
		});

		expect(result).toBe("4.0.18");
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("should use the minimal vnd.npm.install-v1+json accept header to reduce payload size", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				name: "vitest",
				"dist-tags": { latest: "4.0.18" },
			}),
		});

		await getLatestVersion("vitest", { fetch: mockFetch as typeof fetch });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("vitest"),
			expect.objectContaining({
				headers: { Accept: "application/vnd.npm.install-v1+json" },
			}),
		);
	});

	it("should throw a generic error without leaking the package name or URL when the registry responds with a non-ok status", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		});

		await expect(
			getLatestVersion("some-private-package", {
				fetch: mockFetch as typeof fetch,
			}),
		).rejects.toThrow("Failed to fetch registry data for package");
	});

	it("should propagate network-level errors (e.g. DNS failure) without swallowing them", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

		await expect(
			getLatestVersion("vitest", { fetch: mockFetch as typeof fetch }),
		).rejects.toThrow("fetch failed");
	});
});

describe("isUpdateNeeded", () => {
	it("should return false when the current version equals the latest version exactly", () => {
		expect(isUpdateNeeded("4.0.18", "4.0.18")).toBe(false);
	});

	it("should return true when the current version is behind the latest version", () => {
		expect(isUpdateNeeded("4.0.0", "4.0.18")).toBe(true);
	});

	it("should strip a caret (^) prefix before comparing", () => {
		expect(isUpdateNeeded("^4.0.18", "4.0.18")).toBe(false);
		expect(isUpdateNeeded("^4.0.0", "4.0.18")).toBe(true);
	});

	it("should strip a tilde (~) prefix before comparing", () => {
		expect(isUpdateNeeded("~4.0.18", "4.0.18")).toBe(false);
		expect(isUpdateNeeded("~4.0.0", "4.0.18")).toBe(true);
	});
});

import type { PackageJson } from "../../core/scanner/scanner.js";
import { getExternalDependencies, isPublicRegistryVersion } from "../npm.js";

describe("isPublicRegistryVersion", () => {
	it("returns true for standard semver ranges", () => {
		expect(isPublicRegistryVersion("^1.0.0")).toBe(true);
		expect(isPublicRegistryVersion("~2.1.3")).toBe(true);
		expect(isPublicRegistryVersion("15.2.0")).toBe(true);
		expect(isPublicRegistryVersion("latest")).toBe(true);
		expect(isPublicRegistryVersion("alpha")).toBe(true);
	});

	it("returns false for internal pnpm and npm protocols", () => {
		expect(isPublicRegistryVersion("workspace:*")).toBe(false);
		expect(isPublicRegistryVersion("workspace:^1.2.0")).toBe(false);
		expect(isPublicRegistryVersion("catalog:")).toBe(false);
		expect(isPublicRegistryVersion("catalog:default")).toBe(false);
		expect(isPublicRegistryVersion("npm:@myorg/pkg@1.0.0")).toBe(false);
		expect(isPublicRegistryVersion("file:../local-pkg")).toBe(false);
		expect(isPublicRegistryVersion("git+ssh://git@github.com")).toBe(false);
		expect(isPublicRegistryVersion("https://registry.js")).toBe(false);
	});

	it("returns false for empty versions", () => {
		expect(isPublicRegistryVersion("")).toBe(false);
	});
});

describe("getExternalDependencies", () => {
	it("filters out internal protocols and returns only public packages", () => {
		const mockPkg: PackageJson = {
			name: "test-pkg",
			version: "1.0.0",
			dependencies: {
				"standard-dep": "^2.0.0",
				"@internal/shared": "workspace:*",
			},
			devDependencies: {
				"dev-standard": "~1.5.0",
				"@types/node": "catalog:",
				"aliased-pkg": "npm:real-pkg@2.0",
			},
		};

		const externalDeps = getExternalDependencies(mockPkg);

		expect(externalDeps).toHaveLength(2);
		expect(externalDeps).toContain("standard-dep");
		expect(externalDeps).toContain("dev-standard");
		// Internal links are safely ignored
		expect(externalDeps).not.toContain("@internal/shared");
		expect(externalDeps).not.toContain("@types/node");
		expect(externalDeps).not.toContain("aliased-pkg");
	});

	it("handles packages with no dependencies gracefully", () => {
		const emptyPkg: PackageJson = { name: "empty", version: "1" };
		expect(getExternalDependencies(emptyPkg)).toEqual([]);
	});
});
