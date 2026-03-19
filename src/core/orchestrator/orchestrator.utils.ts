import { dirname } from "node:path";

import { getExternalDependencies } from "../../clients/npm.js";
import {
	type AffectedPackagePointer,
	type AffectedSourceFilePointer,
	type GeminiPromptPayload,
	type RiskLevel,
	UpdateType,
} from "../../types/drift.js";
import type { PackageJson } from "../scanner/scanner.js";

export type DependencyMap = Map<
	string,
	Array<{ path: string; pkg: PackageJson; currentVersion: string }>
>;

const getSemverWeight = (updateType: UpdateType): number => {
	switch (updateType) {
		case UpdateType.MAJOR:
			return 300;
		case UpdateType.MINOR:
			return 200;
		default:
			return 100;
	}
};

/**
 * Calculates a priority weight where higher is higher priority.
 * The framework bonus is intentionally smaller than the semver step so
 * framework minors never outrank non-framework majors.
 */
export const calculateDriftWeight = (
	packageName: string,
	updateType: UpdateType,
	coreFrameworks: ReadonlySet<string>,
	astUsageCount: number = 0,
): number => {
	let score = getSemverWeight(updateType);

	if (coreFrameworks.has(packageName)) {
		score += 40;
	}

	score += Math.min(astUsageCount, 25);

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
export const getUpdateType = (current: string, latest: string): UpdateType => {
	const c = current.replace(/^[\^~]/, "").split(".");
	const l = latest.split(".");

	if (c[0] !== l[0]) return UpdateType.MAJOR;
	if (c[1] !== l[1]) return UpdateType.MINOR;
	return UpdateType.PATCH;
};

export const calculateRiskLevel = (
	updateType: UpdateType,
	affectedPackageCount: number,
	usageCount: number,
): RiskLevel => {
	if (
		updateType === UpdateType.MAJOR &&
		(affectedPackageCount > 1 || usageCount >= 5)
	) {
		return "high";
	}

	if (
		updateType === UpdateType.MAJOR ||
		affectedPackageCount > 1 ||
		usageCount >= 2
	) {
		return "medium";
	}

	return "low";
};

export const buildAffectedPackagePointers = (
	payloads: ReadonlyArray<GeminiPromptPayload>,
	packageJsonPaths: ReadonlyMap<string, string>,
): AffectedPackagePointer[] =>
	payloads.map((payload) => ({
		packageName: payload.package.packageName,
		packageJsonPath:
			packageJsonPaths.get(payload.package.packageName) ??
			`${payload.package.packagePath}/package.json`,
	}));

export const buildAffectedSourceFilePointers = (
	payloads: ReadonlyArray<GeminiPromptPayload>,
	packageJsonPaths: ReadonlyMap<string, string>,
): AffectedSourceFilePointer[] =>
	payloads.flatMap((payload) =>
		payload.usages.map((usage) => ({
			packageJsonPath:
				packageJsonPaths.get(payload.package.packageName) ??
				`${payload.package.packagePath}/package.json`,
			filePath: usage.file,
		})),
	);
