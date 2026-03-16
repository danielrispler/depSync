import { getExternalDependencies } from "../../clients/npm.js";
import type { DependencyUsage } from "../ast/ast.js";
import type { PackageJson } from "../scanner/scanner.js";
import { dirname } from "node:path";

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
	/** Dense 1-sentence domain description for near-zero token cost */
	serviceDescription: string;
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

export enum UpdateType {
	MAJOR = 0,
	MINOR = 1,
	PATCH = 2,
}

export interface AggregatedDrift {
	dependencyName: string;
	currentVersions: Set<string>;
	latestVersion: string;
	payloads: GeminiPromptPayload[];
	/** GitHub release notes for the target version, truncated to 3k chars */
	releaseNotes: string | null;
	priorityScore: number;
}

export type DependencyMap = Map<
	string,
	Array<{ path: string; pkg: PackageJson; currentVersion: string }>
>;

// ------------------------------------------------------------------
// Constants & Scoring
// ------------------------------------------------------------------

/**
 * High-impact infrastructure packages that deserve priority weighting.
 */
const CORE_INFRASTRUCTURE = new Set([
	"typescript",
	"react",
	"next",
	"@angular/core",
	"vue",
	"redis",
	"mongodb",
	"aws-sdk",
	"@aws-sdk/client-s3",
	"amqplib",
	"express",
	"fastify",
	"pg",
	"prisma",
]);

/**
 * Calculates a priority score where lower is higher priority.
 * 1. Base score starts with UpdateType (Major=0, Minor=100, Patch=200).
 * 2. If it's a CORE_INFRASTRUCTURE package, subtract 50 from its score.
 */
export const calculatePriorityScore = (
	packageName: string,
	updateType: UpdateType,
): number => {
	let score = updateType * 100;

	if (CORE_INFRASTRUCTURE.has(packageName) || packageName.startsWith("@aws-sdk/")) {
		score -= 50;
	}

	return score;
};

// ------------------------------------------------------------------
// Internal Context Helpers
// ------------------------------------------------------------------

/**
 * Extracts a lightweight service description from package.json.
 */
export const extractServiceDescription = (pkg: PackageJson): string => {
	if (pkg.description && typeof pkg.description === "string") {
		return pkg.description;
	}

	const depSyncConfig = pkg.depSync as { aiContext?: string } | undefined;
	if (depSyncConfig?.aiContext && typeof depSyncConfig.aiContext === "string") {
		return depSyncConfig.aiContext;
	}

	return "";
};

// ------------------------------------------------------------------
// Public Builders
// ------------------------------------------------------------------

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
 * Assembles the base context payload for a single package.
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
			serviceDescription: extractServiceDescription(pkg),
		},
		update: {
			dependencyName,
			currentVersion,
			latestVersion,
		},
		usages: [],
	};
};

/**
 * Simple semver-ish update type detector.
 */
export const getUpdateType = (
	current: string,
	latest: string,
): UpdateType => {
	const c = current.replace(/^[\^~]/, "").split(".");
	const l = latest.split(".");

	if (c[0] !== l[0]) return UpdateType.MAJOR;
	if (c[1] !== l[1]) return UpdateType.MINOR;
	return UpdateType.PATCH;
};
