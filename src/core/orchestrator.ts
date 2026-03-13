import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DependencyUsage } from "./ast.js";
import type { PackageJson } from "./scanner.js";

// ------------------------------------------------------------------
// Internal Helpers
// ------------------------------------------------------------------

/**
 * Validates whether a version string is a standard semver range that
 * can be resolved by the public npm registry.
 *
 * Excludes package manager specific protocols like:
 * - workspace:*   (pnpm internal linking)
 * - catalog:      (pnpm multi-workspace version sharing)
 * - npm:          (npm aliases)
 * - file:         (local filesystem paths)
 * - git+          (git repository links)
 */
export const isPublicRegistryVersion = (version: string): boolean => {
	if (!version) return false;
	const protocols = [
		"workspace:",
		"catalog:",
		"npm:",
		"file:",
		"git+",
		"http://",
		"https://",
	];
	if (protocols.some((p) => version.startsWith(p))) return false;
	return true;
};

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

// ------------------------------------------------------------------
// Context Interfaces (Payloads for Gemini)
// ------------------------------------------------------------------

export interface PackageContext {
	/** e.g. "@mycompany/auth-service" */
	packageName: string;
	/** e.g. "1.2.0" */
	version: string;
	/** The absolute directory holding this package */
	packagePath: string;
	/** The package's README text to provide domain knowledge to the LLM */
	readmeContent: string | null;
}

export interface UpdateContext {
	dependencyName: string;
	currentVersion: string;
	latestVersion: string;
}

export interface GeminiPromptPayload {
	/** Metadata and domain context about the workspace package being updated */
	package: PackageContext;
	/** Details about the dependency that is changing */
	update: UpdateContext;
	/** The AST analysis of precisely how this dependency is used in this package */
	usages: DependencyUsage[];
}

// ------------------------------------------------------------------
// Public Orchestrator Functions
// ------------------------------------------------------------------

/**
 * Filters the dependencies in a PackageJson object, returning an array of
 * dependency names that represent external, public-registry packages.
 */
export const getExternalDependencies = (pkg: PackageJson): string[] => {
	const externalDeps: string[] = [];
	const allDeps = {
		...(pkg.dependencies || {}),
		...(pkg.devDependencies || {}),
	};

	for (const [name, version] of Object.entries(allDeps)) {
		if (isPublicRegistryVersion(version)) {
			externalDeps.push(name);
		}
	}

	return externalDeps;
};

/**
 * Assembles the base context payload for a single package. The usages array
 * will be populated subsequently by the AST extraction module.
 */
export const buildPackagePayload = (
	packageJsonPath: string,
	pkg: PackageJson,
	dependencyName: string,
	currentVersion: string,
	latestVersion: string,
): GeminiPromptPayload => {
	return {
		package: {
			packageName: pkg.name || "unknown",
			version: pkg.version || "0.0.0",
			packagePath: dirname(packageJsonPath),
			readmeContent: tryReadPackageReadme(packageJsonPath),
		},
		update: {
			dependencyName,
			currentVersion,
			latestVersion,
		},
		usages: [], // To be populated by AST scanning phase
	};
};
