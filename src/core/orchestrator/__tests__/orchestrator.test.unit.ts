import { describe, expect, it, vi } from "vitest";
import type { PackageJson } from "../../scanner/scanner.js";
import { buildPackagePayload } from "../orchestrator.utils.js";

vi.mock("../../../clients/npm.js");
vi.mock("../../scanner/scanner.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../scanner/scanner.js")>();
	return {
		...actual,
		tryReadPackageReadme: vi.fn(),
	};
});

// Auto-mock fs to avoid hitting real disks during tests.
// Vitest will automatically replace all exports with vi.fn()
vi.mock("node:fs");

describe("Orchestrator Utilities", () => {
	describe("buildPackagePayload", () => {
		it("assembles the base Gemini payload correctly", async () => {
			const { tryReadPackageReadme } = await import("../../scanner/scanner.js");
			vi.mocked(tryReadPackageReadme).mockReturnValueOnce("# Mock Readme");

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
