import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	buildPackagePayload,
	getExternalDependencies,
	isPublicRegistryVersion,
	tryReadPackageReadme,
} from "../orchestrator.js";
import type { PackageJson } from "../scanner.js";

// Auto-mock fs to avoid hitting real disks during tests.
// Vitest will automatically replace all exports with vi.fn()
vi.mock("node:fs");

describe("Orchestrator Utilities", () => {
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

	describe("tryReadPackageReadme", () => {
		it("returns null if the README file does not exist", () => {
			vi.mocked(fs.statSync).mockImplementationOnce(() => {
				throw new Error("ENOENT: no such file");
			});

			const result = tryReadPackageReadme("/mock/path/package.json");
			expect(result).toBeNull();
		});

		it("returns the full content if it is within the max limit", () => {
			vi.mocked(fs.statSync).mockReturnValueOnce({
				isFile: () => true,
			} as unknown as fs.Stats);
			vi.mocked(fs.readFileSync).mockReturnValueOnce("# Hello World");

			const result = tryReadPackageReadme("/mock/path/package.json");
			expect(result).toBe("# Hello World");
		});

		it("truncates the content and appends a warning if it exceeds the limit", () => {
			vi.mocked(fs.statSync).mockReturnValueOnce({
				isFile: () => true,
			} as unknown as fs.Stats);
			// 15 characters long
			vi.mocked(fs.readFileSync).mockReturnValueOnce("123456789012345");

			const result = tryReadPackageReadme("/mock/path/package.json", 10);
			expect(result).toBe("1234567890\n\n...[README TRUNCATED BY DEPSYNC]");
		});
	});

	describe("buildPackagePayload", () => {
		it("assembles the base Gemini payload correctly", () => {
			vi.mocked(fs.statSync).mockReturnValueOnce({
				isFile: () => true,
			} as unknown as fs.Stats);
			vi.mocked(fs.readFileSync).mockReturnValueOnce("# Mock Readme");

			const pkg: PackageJson = {
				name: "@mock/service",
				version: "2.1.0",
			};

			const payload = buildPackagePayload(
				"/workspace/packages/service/package.json",
				pkg,
				"lodash",
				"^4.17.20",
				"4.17.21",
			);

			expect(payload.package.packageName).toBe("@mock/service");
			expect(payload.package.version).toBe("2.1.0");
			expect(payload.package.packagePath).toBe("/workspace/packages/service");
			expect(payload.package.readmeContent).toBe("# Mock Readme");

			expect(payload.update.dependencyName).toBe("lodash");
			expect(payload.update.currentVersion).toBe("^4.17.20");
			expect(payload.update.latestVersion).toBe("4.17.21");

			// Usages are initialized empty, waiting for AST extraction
			expect(payload.usages).toEqual([]);
		});
	});
});
