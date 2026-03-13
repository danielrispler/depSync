import { describe, expect, it } from "vitest";
import type { DependencyUsage } from "../ast.js";
import { buildGeminiPayload, type GeminiPromptPayload } from "../payload.js";

describe("payload generator", () => {
	const mockDependencyName = "test-pkg";

	it("should generate a valid payload with empty usages", () => {
		const usages: DependencyUsage[] = [];
		const resultString = buildGeminiPayload(mockDependencyName, usages);
		const result = JSON.parse(resultString) as GeminiPromptPayload;

		expect(result.dependencyName).toBe(mockDependencyName);
		expect(result.usages).toEqual([]);
		expect(result.instruction).toContain("CRITICAL INSTRUCTIONS");
	});

	it("should correctly map a complex DependencyUsage into flattened ProcessedUsages", () => {
		const usages: DependencyUsage[] = [
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
						enclosingFunction: null, // module top-level
					},
				],
			},
		];

		const resultString = buildGeminiPayload(mockDependencyName, usages);
		const result = JSON.parse(resultString) as GeminiPromptPayload;

		expect(result.dependencyName).toBe(mockDependencyName);
		expect(result.usages).toHaveLength(2);

		// Check the first processed usage (which has an enclosing function)
		const firstUsage = result.usages[0];
		expect(firstUsage).toBeDefined();
		if (!firstUsage) throw new Error("Expected first usage to be defined");

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

		expect(secondUsage.callingStatement).toBe("testFn(otherData);");
		expect(secondUsage.line).toBe(40);
		expect(secondUsage.enclosingFunction).toBeNull();
	});
});
