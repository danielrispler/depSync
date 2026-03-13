import { assert, describe, expect, it } from "vitest";
import { createProject, extractDependencyUsages } from "../ast.js";

describe("extractDependencyUsages", () => {
	it("returns null when the dependency is not imported at all", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t1.ts",
			`import { other } from "other-pkg";
const x = other();`,
		);
		expect(extractDependencyUsages(sf, "target-pkg")).toBeNull();
	});

	it("returns null when the dependency is imported but never referenced", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t2.ts",
			`import { targetFunc } from "target-pkg";
const x = 1;`,
		);
		expect(extractDependencyUsages(sf, "target-pkg")).toBeNull();
	});

	it("extracts a named import usage with the correct statement, line number, and full enclosing function", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t3.ts",
			`import { compute } from "target-pkg";
import { helper } from "other-pkg";

export const doWork = (input: string): number => {
	const prefix = helper(input);
	const result = compute(prefix);
	return result;
};`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);

		expect(result.file.endsWith("/t3.ts")).toBe(true);
		expect(result.importStatement).toBe(
			'import { compute } from "target-pkg";',
		);
		expect(result.usages).toHaveLength(1);

		const [usage] = result.usages;
		assert(usage !== undefined);

		// Correct statement — VariableStatement, not the raw CallExpression
		expect(usage.statement).toBe("const result = compute(prefix);");

		// Line number must be a positive integer
		expect(usage.line).toBeGreaterThan(0);
		expect(Number.isInteger(usage.line)).toBe(true);

		// Enclosing function resolved via VariableDeclarator → name "doWork"
		assert(usage.enclosingFunction !== null);
		expect(usage.enclosingFunction.name).toBe("doWork");

		// Body contains the full implementation (not the import statement)
		expect(usage.enclosingFunction.body).toContain(
			"const result = compute(prefix);",
		);
		expect(usage.enclosingFunction.body).toContain("return result;");
		expect(usage.enclosingFunction.body).not.toContain("import {");

		// Signature contains parameter list and return type
		expect(usage.enclosingFunction.signature).toContain("input: string");
		expect(usage.enclosingFunction.signature).toContain("number");
	});

	it("extracts a default import used in a class extends clause, with enclosingFunction: null at module level", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t4.ts",
			`import BaseClient from "target-pkg";

class HttpClient extends BaseClient {
	send() { return "ok"; }
}`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);
		expect(result.usages).toHaveLength(1);

		const [usage] = result.usages;
		assert(usage !== undefined);

		// The statement is the ClassDeclaration containing the extends clause
		expect(usage.statement).toContain("class HttpClient extends BaseClient");
		// No enclosing function — class is at module top-level
		expect(usage.enclosingFunction).toBeNull();
	});

	it("extracts multiple namespace import usages, each with line number, all sharing the same enclosing function", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t5.ts",
			`import * as utils from "target-pkg";

function processAll(items: string[]) {
	if (!utils.isReady()) return;
	items.forEach(item => utils.process(item));
}`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);
		expect(result.usages).toHaveLength(2);

		const statements = result.usages.map((u) => u.statement);
		expect(statements.some((s) => s.includes("utils.isReady()"))).toBe(true);
		expect(statements.some((s) => s.includes("utils.process(item)"))).toBe(
			true,
		);

		for (const usage of result.usages) {
			expect(usage.line).toBeGreaterThan(0);
			assert(usage.enclosingFunction !== null);
			expect(usage.enclosingFunction.name).toBe("processAll");
			expect(usage.enclosingFunction.body).toContain("utils.isReady()");
			expect(usage.enclosingFunction.body).toContain("utils.process(item)");
		}
	});

	it("surfaces type-only import usages so the LLM can reason about type-contract changes", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t6.ts",
			`import type { TargetConfig } from "target-pkg";

export const initialize = (cfg: TargetConfig): void => {
	console.log(cfg.host);
};`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);

		// ts-morph resolves the type-identifier reference to the VariableStatement
		// that declares the function: the whole `export const initialize = ...` declaration.
		// The usage is at module top-level, so enclosingFunction is null.
		const [usage] = result.usages;
		assert(usage !== undefined);
		expect(usage.statement).toContain("export const initialize");
		expect(usage.statement).toContain("cfg: TargetConfig");
		expect(usage.enclosingFunction).toBeNull();
	});

	it("returns enclosingFunction: null for a call made directly at module top-level", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t7.ts",
			`import { setup } from "target-pkg";

setup({ debug: true });`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);
		expect(result.usages).toHaveLength(1);

		const [usage] = result.usages;
		assert(usage !== undefined);
		expect(usage.statement).toContain("setup({ debug: true })");
		expect(usage.enclosingFunction).toBeNull();
		expect(usage.line).toBeGreaterThan(0);
	});

	it("deduplicates usages that share the same statement (e.g. foo(bar()) on one line)", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t8.ts",
			`import { foo, bar } from "target-pkg";

function run() {
	const result = foo(bar());
}`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);

		// foo and bar are both in the same VariableStatement — one UsageContext
		expect(result.usages).toHaveLength(1);

		const [usage] = result.usages;
		assert(usage !== undefined);
		expect(usage.statement).toBe("const result = foo(bar());");
	});
	it("resolves local callers of the enclosing function, showing EXACTLY where it is used in the same file", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t9.ts",
			`import {x} from "daniel";
const a = b(2)

function b (num: number){ return x(num + 4); }`,
		);

		const result = extractDependencyUsages(sf, "daniel");
		assert(result !== null);
		expect(result.usages).toHaveLength(1);

		const [usage] = result.usages;
		assert(usage !== undefined);
		expect(usage.statement).toBe("return x(num + 4);");

		assert(usage.enclosingFunction !== null);
		expect(usage.enclosingFunction.name).toBe("b");
		expect(usage.enclosingFunction.isExported).toBe(false);

		// Local callers should detect where `b` is called!
		expect(usage.localCallers).toHaveLength(1);
		const [caller] = usage.localCallers;
		assert(caller !== undefined);
		expect(caller.statement).toBe("const a = b(2)");
		expect(caller.enclosingFunction).toBeNull(); // called at top-level
	});

	it("identifies when an enclosing function is part of the public exported API", () => {
		const project = createProject();
		const sf = project.createSourceFile(
			"t10.ts",
			`import { dep } from "target-pkg";
export const fn = () => { dep(); };
export class MyClass { method() { dep(); } }`,
		);

		const result = extractDependencyUsages(sf, "target-pkg");
		assert(result !== null);
		expect(result.usages).toHaveLength(2);

		const usageFn = result.usages.find(
			(u) => u.enclosingFunction?.name === "fn",
		);
		const usageMethod = result.usages.find(
			(u) => u.enclosingFunction?.name === "method",
		);

		assert(usageFn !== undefined && usageFn.enclosingFunction !== null);
		assert(usageMethod !== undefined && usageMethod.enclosingFunction !== null);

		expect(usageFn.enclosingFunction.isExported).toBe(true);
		// The method is in an exported class, so it IS part of the exported surface!
		expect(usageMethod.enclosingFunction.isExported).toBe(true);
	});
});
