import semver from "semver";
import type { PackageJson } from "../core/scanner/scanner.js";

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
 * In-memory cache for registry lookups during the current run.
 */
let registryCache: Map<string, Promise<string>> = new Map<
	string,
	Promise<string>
>();

/**
 * Clears the registry cache. Used primarily for testing.
 */
export const clearRegistryCache = (): void => {
	registryCache = new Map<string, Promise<string>>();
};

/**
 * Fetches the latest version of a package from the public npm registry.
 * Uses an in-memory cache to prevent redundant network calls.
 */
export const getLatestVersion = (
	packageName: string,
	deps: NpmDependencies = defaultNpmDependencies,
): Promise<string> => {
	const cached = registryCache.get(packageName);
	if (cached) return cached;

	const promise = (async () => {
		const url = `https://registry.npmjs.org/${packageName}`;
		const response = await deps.fetch(url, {
			headers: {
				Accept: "application/vnd.npm.install-v1+json",
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch registry data for ${packageName}`);
		}

		const data = (await response.json()) as NpmRegistryResponse;
		return data["dist-tags"].latest;
	})();

	registryCache.set(packageName, promise);
	return promise;
};

/**
 * Mathematical check to determine if an update is required.
 * Uses the 'semver' package to handle ranges and prefixes accurately.
 */
export const isUpdateNeeded = (
	currentVersion: string,
	latestVersion: string,
): boolean => {
	try {
		// Rule 1: Ignore Prereleases. depSync only analyzes stable releases.
		if (semver.prerelease(latestVersion)) {
			return false;
		}

		const c = semver.coerce(currentVersion);
		const l = semver.coerce(latestVersion);

		if (!c || !l) {
			return currentVersion.replace(/^[\^~]/, "") !== latestVersion;
		}

		// Rule 2: Respect the Range. If the latest version safely satisfies the
		// existing range, we don't treat it as a drift.
		if (semver.satisfies(latestVersion, currentVersion)) {
			return false;
		}

		// Only flag a drift if the latest stable version is strictly newer
		// and falls OUTSIDE the current range.
		return semver.gt(l, c);
	} catch {
		return currentVersion.replace(/^[\^~]/, "") !== latestVersion;
	}
};

/**
 * Validates whether a version string is a standard semver range that
 * can be resolved by the public npm registry.
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
	const allDeps = {
		...(pkg.dependencies || {}),
		...(pkg.devDependencies || {}),
	};

	return Object.entries(allDeps)
		.filter(([_, version]) => isPublicRegistryVersion(version))
		.map(([name]) => name);
};
