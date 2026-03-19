import { describe, expect, it } from "vitest";
import { UpdateType } from "../../../types/drift.js";
import type { PackageJson } from "../../scanner/scanner.js";
import {
	buildPackagePayload,
	calculateDriftWeight,
	extractServiceDescription,
} from "../orchestrator.utils.js";

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

			// Usages are initialized empty, waiting for AST extraction
			expect(payload.usages).toEqual([]);
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
	});
});
