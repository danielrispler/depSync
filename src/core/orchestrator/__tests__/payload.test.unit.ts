import { describe, expect, it } from "vitest";
import type { GeminiPromptPayload } from "../../../types/drift.js";
import { buildGeminiPayload, type GeminiFinalPrompt } from "../payload.js";

describe("payload generator", () => {
	const mockDependencyName = "test-pkg";

	it("should generate a valid payload with empty payloads array", () => {
		const payloads: GeminiPromptPayload[] = [];
		const resultString = buildGeminiPayload(mockDependencyName, payloads, null);
		const result = JSON.parse(resultString) as GeminiFinalPrompt;

		expect(result.dependencyName).toBe(mockDependencyName);
		expect(result.usages).toEqual([]);
		expect(result.releaseNotes).toBeNull();
		expect(result.instruction).toContain("expert migration assistant");
		expect(result.instruction).toContain(
			"CRITICAL: DO NOT modify pnpm-lock.yaml or any lockfiles.",
		);
	});

	it("should correctly map complex payloads into flattened ProcessedUsages with service context", () => {
		const payloads: GeminiPromptPayload[] = [
			{
				package: {
					packageName: "@mycompany/auth-service",
					version: "1.0.0",
					packagePath: "/workspace/apps/auth",
					serviceDescription: "Handles JWT Authentication",
				},
				update: {
					dependencyName: "test-pkg",
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
				},
				usages: [
					{
						file: "/src/index.ts",
						importStatement: "import { testFn } from 'test-pkg';",
						usages: [
							{
								statement: "testFn(data);",
								line: 10,
								localCallers: [
									{
										statement: "wrapper();",
										line: 25,
										enclosingFunction: null,
									},
								],
								enclosingFunction: {
									name: "wrapper",
									signature: "const wrapper = (data: any) =>",
									body: "{ testFn(data); }",
									isExported: true,
								},
							},
							{
								statement: "testFn(otherData);",
								line: 40,
								localCallers: [],
								enclosingFunction: null,
							},
						],
					},
				],
			},
		];

		const releaseNotes = "## Breaking Changes\n- Removed testFn";
		const resultString = buildGeminiPayload(
			mockDependencyName,
			payloads,
			releaseNotes,
		);
		const result = JSON.parse(resultString) as GeminiFinalPrompt;

		expect(result.dependencyName).toBe(mockDependencyName);
		expect(result.releaseNotes).toBe(releaseNotes);
		expect(result.usages).toHaveLength(2);

		// Check the first processed usage (which has an enclosing function)
		const firstUsage = result.usages[0];
		expect(firstUsage).toBeDefined();
		if (!firstUsage) throw new Error("Expected first usage to be defined");

		expect(firstUsage.serviceName).toBe("@mycompany/auth-service");
		expect(firstUsage.serviceDescription).toBe("Handles JWT Authentication");
		expect(firstUsage.file).toBe("/src/index.ts");
		expect(firstUsage.callingStatement).toBe("testFn(data);");
		expect(firstUsage.line).toBe(10);

		expect(firstUsage.enclosingFunction).toBeDefined();
		expect(firstUsage.enclosingFunction?.name).toBe("wrapper");
		expect(firstUsage.enclosingFunction?.isExported).toBe(true);
		expect(firstUsage.enclosingFunction?.localCallers).toHaveLength(1);
		expect(firstUsage.enclosingFunction?.localCallers[0]?.statement).toBe(
			"wrapper();",
		);

		// Check the second processed usage (top-level module)
		const secondUsage = result.usages[1];
		expect(secondUsage).toBeDefined();
		if (!secondUsage) throw new Error("Expected second usage to be defined");

		expect(secondUsage.serviceName).toBe("@mycompany/auth-service");
		expect(secondUsage.callingStatement).toBe("testFn(otherData);");
		expect(secondUsage.line).toBe(40);
		expect(secondUsage.enclosingFunction).toBeNull();
	});
});
