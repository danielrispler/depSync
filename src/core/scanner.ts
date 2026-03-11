import { readFile } from "node:fs/promises";
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
}

const defaultDependencies: ScannerDependencies = {
	createGlobber: glob.create,
	readFile,
	warning: core.warning,
};

/**
 * Scans the workspace for package.json files while strictly excluding
 * irrelevant or heavy directories like node_modules, dist, and build.
 */
export const scanWorkspace = async (
	workspaceRoot: string,
	deps: ScannerDependencies = defaultDependencies,
): Promise<Map<string, PackageJson>> => {
	const patterns = [
		`${workspaceRoot}/**/package.json`,
		`!${workspaceRoot}/**/node_modules/**`,
		`!${workspaceRoot}/**/dist/**`,
		`!${workspaceRoot}/**/build/**`,
		`!${workspaceRoot}/**/.git/**`,
	].join("\n");

	const globber = await deps.createGlobber(patterns);
	const files = await globber.glob();

	const parsedEntries = await Promise.all(
		files.map(async (file) => {
			try {
				const content = await deps.readFile(file, "utf-8");
				const parsed = JSON.parse(content) as PackageJson;
				return [file, parsed] as const;
			} catch {
				// To guarantee zero leakage, we swallow the actual error and path
				// and just emit a generic warning.
				deps.warning("Failed to parse a package.json file. Skipping.");
				return null;
			}
		}),
	);

	const validEntries = parsedEntries.filter(
		(entry): entry is [string, PackageJson] => entry !== null,
	);

	return new Map<string, PackageJson>(validEntries);
};
