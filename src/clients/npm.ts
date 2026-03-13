export type NpmRegistryResponse = {
	name: string;
	"dist-tags": {
		latest: string;
		[key: string]: string;
	};
	[key: string]: unknown;
};

export interface NpmDependencies {
	fetch: typeof fetch;
}

const defaultNpmDependencies: NpmDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
};

/**
 * Fetches the latest version of a package from the public npm registry.
 * Uses native fetch avoiding extra dependencies.
 */
export const getLatestVersion = async (
	packageName: string,
	deps: NpmDependencies = defaultNpmDependencies,
): Promise<string> => {
	const url = `https://registry.npmjs.org/${packageName}`;
	const response = await deps.fetch(url, {
		headers: {
			Accept: "application/vnd.npm.install-v1+json",
		},
	});

	if (!response.ok) {
		throw new Error("Failed to fetch registry data for package");
	}

	const data = (await response.json()) as NpmRegistryResponse;
	return data["dist-tags"].latest;
};

/**
 * Basic pure function check to determine if an update is needed.
 * It strictly ignores existing semver prefixes for safe, naive matching.
 */
export const isUpdateNeeded = (
	currentVersion: string,
	latestVersion: string,
): boolean => {
	const cleanCurrent = currentVersion.replace(/^[\^~]/, "");
	return cleanCurrent !== latestVersion;
};

import type { PackageJson } from "../core/scanner/scanner.js";

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
