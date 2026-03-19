import { describe, expect, it, vi } from "vitest";
import { getExternalDependencies } from "../../../clients/npm.js";
import { UpdateType } from "../../../types/drift.js";
import type { PackageJson } from "../../scanner/scanner.js";
import {
	buildAffectedPackagePointers,
	buildAffectedSourceFilePointers,
	buildDependencyMap,
	buildPackagePayload,
	calculateDriftWeight,
	calculateRiskLevel,
	extractServiceDescription,
	getUpdateType,
} from "../orchestrator.utils.js";

vi.mock("../../../clients/npm.js", () => ({
	getExternalDependencies: vi.fn(),
}));

describe("Orchestrator Utilities", () => {
	describe("extractServiceDescription", () => {
		it("should return the description field when present", () => {
			const pkg: PackageJson = {
				name: "test",
				description: "Handles JWT Authentication",
			};
			expect(extractServiceDescription(pkg)).toBe("Handles JWT Authentication");
		});

		it("should fallback to depSync.aiContext when description is missing", () => {
			const pkg: PackageJson = {
				name: "test",
				depSync: { aiContext: "Core payment processing service" },
			};
			expect(extractServiceDescription(pkg)).toBe(
				"Core payment processing service",
			);
		});

		it("should return empty string when neither field exists", () => {
			const pkg: PackageJson = { name: "test" };
			expect(extractServiceDescription(pkg)).toBe("");
		});

		it("should prefer description over depSync.aiContext", () => {
			const pkg: PackageJson = {
				name: "test",
				description: "Primary description",
				depSync: { aiContext: "Fallback context" },
			};
			expect(extractServiceDescription(pkg)).toBe("Primary description");
		});
	});

	describe("calculateDriftWeight", () => {
		it("prioritizes configured core-framework majors over standard majors", () => {
			const coreFrameworks = new Set(["@angular/core", "express"]);

			const frameworkMajor = calculateDriftWeight(
				"@angular/core",
				UpdateType.MAJOR,
				coreFrameworks,
			);
			const standardMajor = calculateDriftWeight(
				"left-pad",
				UpdateType.MAJOR,
				coreFrameworks,
			);

			expect(frameworkMajor).toBeGreaterThan(standardMajor);
		});

		it("keeps non-framework majors above framework minors", () => {
			const coreFrameworks = new Set(["express"]);

			const standardMajor = calculateDriftWeight(
				"left-pad",
				UpdateType.MAJOR,
				coreFrameworks,
			);
			const frameworkMinor = calculateDriftWeight(
				"express",
				UpdateType.MINOR,
				coreFrameworks,
			);

			expect(standardMajor).toBeGreaterThan(frameworkMinor);
		});

		it("increases weight linearly with AST usage count (capped at 25)", () => {
			const coreFrameworks = new Set<string>();

			const lowUsage = calculateDriftWeight(
				"pkg",
				UpdateType.MINOR,
				coreFrameworks,
				5,
			);
			const highUsage = calculateDriftWeight(
				"pkg",
				UpdateType.MINOR,
				coreFrameworks,
				20,
			);
			const cappedUsage = calculateDriftWeight(
				"pkg",
				UpdateType.MINOR,
				coreFrameworks,
				100, // should cap at 25
			);

			expect(highUsage).toBeGreaterThan(lowUsage);
			expect(cappedUsage).toBe(
				calculateDriftWeight("pkg", UpdateType.MINOR, coreFrameworks, 25),
			);
		});
	});

	describe("buildDependencyMap", () => {
		it("inverts the mapping correctly and filters only external dependencies", () => {
			const packages = new Map<string, PackageJson>([
				[
					"/p1/package.json",
					{
						name: "p1",
						dependencies: { lodash: "^4.0.0", workspace: "workspace:*" },
					},
				],
				[
					"/p2/package.json",
					{
						name: "p2",
						devDependencies: { lodash: "^4.1.0", vitest: "1.0.0" },
					},
				],
			]);

			// Mock getExternalDependencies to filter out 'workspace:*'
			vi.mocked(getExternalDependencies).mockImplementation(
				(pkg: PackageJson) => {
					return Object.keys({
						...pkg.dependencies,
						...pkg.devDependencies,
					}).filter((d) => d !== "workspace");
				},
			);

			const dependencyMap = buildDependencyMap(packages);

			expect(dependencyMap.has("lodash")).toBe(true);
			expect(dependencyMap.get("lodash")).toHaveLength(2);
			expect(dependencyMap.get("vitest")).toHaveLength(1);
			expect(dependencyMap.has("workspace")).toBe(false);

			expect(dependencyMap.get("lodash")?.[0]?.path).toBe("/p1/package.json");
			expect(dependencyMap.get("lodash")?.[0]?.currentVersion).toBe("^4.0.0");
		});
	});

	describe("buildPackagePayload", () => {
		it("assembles the base Gemini payload with serviceDescription", () => {
			const pkg: PackageJson = {
				name: "@mock/service",
				version: "2.1.0",
				description: "Handles user registration",
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
			expect(payload.package.serviceDescription).toBe(
				"Handles user registration",
			);

			expect(payload.update.dependencyName).toBe("lodash");
			expect(payload.update.currentVersion).toBe("^4.17.20");
			expect(payload.update.latestVersion).toBe("4.17.21");

			expect(payload.usages).toEqual([]);
		});
	});

	describe("getUpdateType", () => {
		it("correctly identifies MAJOR updates", () => {
			expect(getUpdateType("1.0.0", "2.0.0")).toBe(UpdateType.MAJOR);
			expect(getUpdateType("^1.5.0", "2.0.0")).toBe(UpdateType.MAJOR);
		});

		it("correctly identifies MINOR updates", () => {
			expect(getUpdateType("1.0.0", "1.1.0")).toBe(UpdateType.MINOR);
			expect(getUpdateType("~1.0.0", "1.1.0")).toBe(UpdateType.MINOR);
		});

		it("identifies PATCH or lower", () => {
			expect(getUpdateType("1.0.0", "1.0.1")).toBe(UpdateType.PATCH);
			expect(getUpdateType("1.0.0", "1.0.0")).toBe(UpdateType.PATCH);
		});

		it("handles non-semver strings gracefully", () => {
			expect(getUpdateType("latest", "1.0.0")).toBe(UpdateType.PATCH);
		});
	});

	describe("calculateRiskLevel", () => {
		it("is HIGH for major updates with multiple packages or high usage count", () => {
			expect(calculateRiskLevel(UpdateType.MAJOR, 2, 1)).toBe("high");
			expect(calculateRiskLevel(UpdateType.MAJOR, 1, 5)).toBe("high");
		});

		it("is MEDIUM for single-package majors or minor updates with wide usage", () => {
			expect(calculateRiskLevel(UpdateType.MAJOR, 1, 1)).toBe("medium");
			expect(calculateRiskLevel(UpdateType.MINOR, 2, 1)).toBe("medium");
			expect(calculateRiskLevel(UpdateType.MINOR, 1, 2)).toBe("medium");
		});

		it("is LOW for isolated minor/patch updates", () => {
			expect(calculateRiskLevel(UpdateType.MINOR, 1, 1)).toBe("low");
			expect(calculateRiskLevel(UpdateType.PATCH, 1, 1)).toBe("low");
		});
	});

	describe("Pointer Builders", () => {
		const mockPayloads = [
			{
				package: {
					packageName: "web",
					packagePath: "/apps/web",
					version: "1.0.0",
					serviceDescription: "",
				},
				update: {
					dependencyName: "x",
					currentVersion: "1",
					latestVersion: "2",
				},
				usages: [
					{ file: "/apps/web/src/f1.ts", importStatement: "", usages: [] },
					{ file: "/apps/web/src/f2.ts", importStatement: "", usages: [] },
				],
			},
		];

		const mockPaths = new Map([["web", "/apps/web/package.json"]]);

		it("buildAffectedPackagePointers creates a unique list of package.json paths", () => {
			const pointers = buildAffectedPackagePointers(mockPayloads, mockPaths);
			expect(pointers).toHaveLength(1);
			expect(pointers[0]).toEqual({
				packageName: "web",
				packageJsonPath: "/apps/web/package.json",
			});
		});

		it("buildAffectedSourceFilePointers creates a flat list of source file paths with their package context", () => {
			const pointers = buildAffectedSourceFilePointers(mockPayloads, mockPaths);
			expect(pointers).toHaveLength(2);
			expect(pointers[0]?.filePath).toBe("/apps/web/src/f1.ts");
			expect(pointers[0]?.packageJsonPath).toBe("/apps/web/package.json");
			expect(pointers[1]?.filePath).toBe("/apps/web/src/f2.ts");
		});
	});
});
