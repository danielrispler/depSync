import { dirname } from "node:path";
import { getExternalDependencies } from "../../clients/npm.js";
import type { DependencyUsage } from "../ast/ast.js";
import { type PackageJson, tryReadPackageReadme } from "../scanner/scanner.js";

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

export interface AggregatedDrift {
	dependencyName: string;
	currentVersions: Set<string>;
	latestVersion: string;
	payloads: GeminiPromptPayload[];
}

export type DependencyMap = Map<
	string,
	Array<{ path: string; pkg: PackageJson; currentVersion: string }>
>;

/**
 * Inverts the dependency mapping from Package -> Dependencies to Dependency -> Packages.
 */
export const buildDependencyMap = (
	packages: Map<string, PackageJson>,
): DependencyMap => {
	const dependencyMap: DependencyMap = new Map();

	for (const [pkgPath, pkg] of packages.entries()) {
		const allDeps = {
			...(pkg.dependencies || {}),
			...(pkg.devDependencies || {}),
		};

		const externalDeps = getExternalDependencies(pkg);
		for (const dep of externalDeps) {
			const currentVersion = allDeps[dep];
			if (!currentVersion) continue;

			if (!dependencyMap.has(dep)) {
				dependencyMap.set(dep, []);
			}
			dependencyMap.get(dep)?.push({ path: pkgPath, pkg, currentVersion });
		}
	}

	return dependencyMap;
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
