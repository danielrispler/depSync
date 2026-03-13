import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import * as core from "@actions/core";
import * as glob from "@actions/glob";

export type PackageJson = {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	[key: string]: unknown;
};

// Dependency injection interfaces for safe, testable code
export interface ScannerDependencies {
	createGlobber: typeof glob.create;
	readFile: typeof readFile;
	warning: typeof core.warning;
	// debug is gated behind "Step Debug Logging" in GitHub Actions —
	// safe to log technical error details here without leaking to normal run logs.
	debug: typeof core.debug;
}

const defaultDependencies: ScannerDependencies = {
	createGlobber: glob.create,
	readFile,
	warning: core.warning,
	debug: core.debug,
};

const parseEntries = (
	files: string[],
	deps: ScannerDependencies,
): Promise<([string, PackageJson] | null)[]> =>
	Promise.all(
		files.map(async (file) => {
			try {
				const content = await deps.readFile(file, "utf-8");
				const raw: unknown = JSON.parse(content);

				// Runtime guard: JSON.parse accepts primitives (e.g. "hello", 42).
				// A valid package.json must be a plain object.
				if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
					throw new TypeError("File content is not a JSON object.");
				}

				return [file, raw as PackageJson] as const;
			} catch (error) {
				// Emit the error message only under Step Debug Logging (admin opt-in).
				// Log just the filename — never the absolute path — to prevent
				// leaking internal monorepo directory structure in the warning.
				deps.debug(error instanceof Error ? error.message : String(error));
				deps.warning(`Failed to parse ${basename(file)}. Skipping.`);
				return null;
			}
		}),
	);

const getPatterns = (workspaceRoot: string): string => {
	const pattern = [`${workspaceRoot}/**/package.json`];
	const antipatterns = [
		`!${workspaceRoot}/**/node_modules/**`,
		`!${workspaceRoot}/**/dist/**`,
		`!${workspaceRoot}/**/build/**`,
		`!${workspaceRoot}/**/.git/**`,
	];

	return [...pattern, ...antipatterns].join("\n");
};

const getSourceFilePatterns = (packageRoot: string): string => {
	// Look for all TypeScript and TSX files in the package directory
	const patterns = [`${packageRoot}/**/*.ts`, `${packageRoot}/**/*.tsx`];
	// Crucially, exclude external type definitions and compiled output
	const antipatterns = [
		`!${packageRoot}/**/node_modules/**`,
		`!${packageRoot}/**/dist/**`,
		`!${packageRoot}/**/build/**`,
		`!${packageRoot}/**/out/**`,
		`!${packageRoot}/**/*.d.ts`,
	];

	return [...patterns, ...antipatterns].join("\n");
};

const isValidEntry = (
	entry: [string, PackageJson] | null,
): entry is [string, PackageJson] => entry !== null;

/**
 * Scans the workspace for package.json files while strictly excluding
 * irrelevant or heavy directories like node_modules, dist, and build.
 */
export const scanWorkspace = async (
	workspaceRoot: string,
	deps: ScannerDependencies = defaultDependencies,
): Promise<Map<string, PackageJson>> => {
	const patterns = getPatterns(workspaceRoot);
	const globber = await deps.createGlobber(patterns);
	const files = await globber.glob();
	const parsedEntries = await parseEntries(files, deps);
	const validEntries = parsedEntries.filter(isValidEntry);

	return new Map(validEntries);
};

/**
 * Scans a specific package directory for TypeScript source files to be ingested
 * into ts-morph. Carefully avoids d.ts and output directories to save memory.
 */
export const scanTypeScriptFiles = async (
	packageRoot: string,
	deps: ScannerDependencies = defaultDependencies,
): Promise<string[]> => {
	const patterns = getSourceFilePatterns(packageRoot);
	const globber = await deps.createGlobber(patterns);
	return globber.glob();
};

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Safely attempts to read the README.md file from a package directory.
 * Fails gracefully and returns null if the file doesn't exist or is unreadable.
 * Truncates massive READMEs to prevent LLM token explosion (default: 10,000 chars).
 */
export const tryReadPackageReadme = (
	packageJsonPath: string,
	maxChars = 10000,
): string | null => {
	try {
		const pkgDir = dirname(packageJsonPath);
		const readmePath = join(pkgDir, "README.md");
		const stat = statSync(readmePath);

		if (!stat.isFile()) return null;

		const content = readFileSync(readmePath, "utf-8");
		if (content.length > maxChars) {
			return `${content.slice(0, maxChars)}\n\n...[README TRUNCATED BY DEPSYNC]`;
		}
		return content;
	} catch {
		// README is optional; safe to ignore missing files
		return null;
	}
};
