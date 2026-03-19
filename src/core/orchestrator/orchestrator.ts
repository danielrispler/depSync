import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getReleaseNotesForDependency } from "../../clients/changelog.js";
import { getLatestVersion, isUpdateNeeded } from "../../clients/npm.js";
import type {
	AggregatedDrift,
	DepSyncIssueContext,
	GeminiPromptPayload,
	UpdateType,
} from "../../types/drift.js";
import { createProject, extractDependencyUsages } from "../ast/ast.js";
import {
	type PackageJson,
	scanTypeScriptFiles,
	scanWorkspace,
} from "../scanner/scanner.js";
import {
	buildAffectedPackagePointers,
	buildAffectedSourceFilePointers,
	buildDependencyMap,
	buildPackagePayload,
	calculateDriftWeight,
	getUpdateType,
} from "./orchestrator.utils.js";

const AST_CANDIDATE_LIMIT = 10;
const FINAL_DRIFT_LIMIT = 4;

type PackageUsage = {
	path: string;
	pkg: PackageJson;
	currentVersion: string;
};

type RankedDriftCandidate = {
	dep: string;
	baseWeight: number;
	currentVersions: Set<string>;
	latestVersion: string;
	updateType: UpdateType;
	usages: PackageUsage[];
};

const getCurrentVersionForDependency = (
	pkg: PackageJson,
	dependencyName: string,
): string | null => {
	const version =
		pkg.dependencies?.[dependencyName] ?? pkg.devDependencies?.[dependencyName];
	return typeof version === "string" ? version : null;
};

const parsePackageJson = async (
	packageJsonPath: string,
): Promise<PackageJson> => {
	const content = await readFile(packageJsonPath, "utf-8");
	const raw: unknown = JSON.parse(content);

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new TypeError(`Invalid package.json at ${packageJsonPath}`);
	}

	return raw as PackageJson;
};

const analyzeDependencyUsage = async (
	dependencyName: string,
	latestVersion: string,
	usages: PackageUsage[],
	fileOverrideMap?: ReadonlyMap<string, string[]>,
): Promise<{
	payloads: GeminiPromptPayload[];
	affectedPackages: AggregatedDrift["affectedPackages"];
	affectedSourceFiles: AggregatedDrift["affectedSourceFiles"];
	usageCount: number;
}> => {
	const payloads: GeminiPromptPayload[] = [];
	const packageJsonPaths = new Map<string, string>();
	const project = createProject();

	try {
		for (const { path: pkgPath, pkg, currentVersion } of usages) {
			const packageRoot = dirname(pkgPath);
			const candidateFiles =
				fileOverrideMap?.get(pkgPath) ??
				(await scanTypeScriptFiles(packageRoot));

			if (candidateFiles.length === 0) {
				continue;
			}

			packageJsonPaths.set(pkg.name || "unknown", pkgPath);
			project.addSourceFilesAtPaths(candidateFiles);

			const packagePayload = buildPackagePayload(
				pkgPath,
				pkg,
				dependencyName,
				currentVersion,
				latestVersion,
			);

			for (const sourceFile of project.getSourceFiles()) {
				const usage = extractDependencyUsages(sourceFile, dependencyName);
				if (usage) {
					packagePayload.usages.push(usage);
				}
			}

			if (packagePayload.usages.length > 0) {
				payloads.push(packagePayload);
			}

			// Aggressive memory cleanup: remove all source files from the project instance
			// to free up ts-morph node memory before processing the next package.
			for (const sourceFile of project.getSourceFiles()) {
				project.removeSourceFile(sourceFile);
			}
		}
	} finally {
		// No-op - ts-morph Project doesn't require explicit disposal,
		// and we've already cleared source files in the loop.
	}

	const usageCount = payloads.reduce(
		(total, payload) =>
			total +
			payload.usages.reduce(
				(usageTotal, usage) => usageTotal + usage.usages.length,
				0,
			),
		0,
	);

	return {
		payloads,
		affectedPackages: buildAffectedPackagePointers(payloads, packageJsonPaths),
		affectedSourceFiles: buildAffectedSourceFilePointers(
			payloads,
			packageJsonPaths,
		),
		usageCount,
	};
};

const buildRankedCandidates = async (
	packages: Map<string, PackageJson>,
	coreFrameworks: ReadonlySet<string>,
): Promise<RankedDriftCandidate[]> => {
	const dependencyMap = buildDependencyMap(packages);
	const candidates: RankedDriftCandidate[] = [];

	for (const [dep, usages] of dependencyMap.entries()) {
		try {
			const latestVersion = await getLatestVersion(dep);
			const outdatedUsages = usages.filter((usage) =>
				isUpdateNeeded(usage.currentVersion, latestVersion),
			);

			if (outdatedUsages.length === 0) continue;

			const currentVersions = new Set(
				outdatedUsages.map((usage) => usage.currentVersion),
			);
			const firstCurrentVersion = Array.from(currentVersions)[0];
			if (!firstCurrentVersion) continue;

			const updateType = getUpdateType(firstCurrentVersion, latestVersion);
			const baseWeight = calculateDriftWeight(dep, updateType, coreFrameworks);

			candidates.push({
				dep,
				baseWeight,
				currentVersions,
				latestVersion,
				updateType,
				usages: outdatedUsages,
			});
		} catch (error) {
			console.error(`Failed npm check for ${dep}: ${error}`);
		}
	}

	return candidates.sort((left, right) => right.baseWeight - left.baseWeight);
};

const finalizeCandidates = async (
	candidates: RankedDriftCandidate[],
	githubToken: string,
	coreFrameworks: ReadonlySet<string>,
): Promise<AggregatedDrift[]> => {
	const astRankedCandidates = await Promise.all(
		candidates.slice(0, AST_CANDIDATE_LIMIT).map(async (candidate) => {
			const astAnalysis = await analyzeDependencyUsage(
				candidate.dep,
				candidate.latestVersion,
				candidate.usages,
			);

			if (astAnalysis.payloads.length === 0) {
				return null;
			}

			return {
				candidate,
				astAnalysis,
				driftWeight: calculateDriftWeight(
					candidate.dep,
					candidate.updateType,
					coreFrameworks,
					astAnalysis.usageCount,
				),
			};
		}),
	);

	const selectedCandidates = astRankedCandidates
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
		.sort((left, right) => right.driftWeight - left.driftWeight)
		.slice(0, FINAL_DRIFT_LIMIT);

	return Promise.all(
		selectedCandidates.map(async ({ candidate, astAnalysis, driftWeight }) => ({
			dependencyName: candidate.dep,
			currentVersions: candidate.currentVersions,
			latestVersion: candidate.latestVersion,
			payloads: astAnalysis.payloads,
			releaseNotes: await getReleaseNotesForDependency(
				githubToken,
				candidate.dep,
				candidate.latestVersion,
			),
			driftWeight,
			updateType: candidate.updateType,
			affectedPackages: astAnalysis.affectedPackages,
			affectedSourceFiles: astAnalysis.affectedSourceFiles,
			usageCount: astAnalysis.usageCount,
		})),
	);
};

/**
 * Main Orchestrator Pipeline
 * 1. Rank all outdated dependencies from package manifests.
 * 2. Run AST analysis only on the top 10 ranked dependencies.
 * 3. Re-rank with AST footprint and keep the top 4.
 * 4. Fetch release notes only for the final 4 candidates.
 */
export const analyzeMonorepoDrift = async (
	workspaceRoot: string,
	githubToken: string,
	coreFrameworks: ReadonlySet<string> = new Set<string>(),
): Promise<AggregatedDrift[]> => {
	const packages = await scanWorkspace(workspaceRoot);
	const rankedCandidates = await buildRankedCandidates(
		packages,
		coreFrameworks,
	);
	return finalizeCandidates(rankedCandidates, githubToken, coreFrameworks);
};

export const rebuildDriftFromIssueContext = async (
	context: DepSyncIssueContext,
	githubToken: string,
	coreFrameworks: ReadonlySet<string> = new Set<string>(),
): Promise<AggregatedDrift> => {
	const fileOverrideMap = new Map<string, string[]>();
	const packageUsageEntries: PackageUsage[] = [];

	for (const affectedPackage of context.affectedPackages) {
		const pkg = await parsePackageJson(affectedPackage.packageJsonPath);
		const currentVersion = getCurrentVersionForDependency(
			pkg,
			context.dependencyName,
		);

		if (!currentVersion) {
			throw new Error(
				`Dependency ${context.dependencyName} was not found in ${affectedPackage.packageJsonPath}.`,
			);
		}

		const files = context.affectedSourceFiles
			.filter(
				(entry) => entry.packageJsonPath === affectedPackage.packageJsonPath,
			)
			.map((entry) => entry.filePath);

		fileOverrideMap.set(
			affectedPackage.packageJsonPath,
			Array.from(new Set(files)),
		);

		packageUsageEntries.push({
			path: affectedPackage.packageJsonPath,
			pkg,
			currentVersion,
		});
	}

	const firstCurrentVersion = context.currentVersions[0];
	if (!firstCurrentVersion) {
		throw new Error("depSync issue context did not include a current version.");
	}

	const updateType = getUpdateType(firstCurrentVersion, context.latestVersion);
	const astAnalysis = await analyzeDependencyUsage(
		context.dependencyName,
		context.latestVersion,
		packageUsageEntries,
		fileOverrideMap,
	);

	return {
		dependencyName: context.dependencyName,
		currentVersions: new Set(context.currentVersions),
		latestVersion: context.latestVersion,
		payloads: astAnalysis.payloads,
		releaseNotes: await getReleaseNotesForDependency(
			githubToken,
			context.dependencyName,
			context.latestVersion,
		),
		driftWeight: calculateDriftWeight(
			context.dependencyName,
			updateType,
			coreFrameworks,
			astAnalysis.usageCount,
		),
		updateType,
		affectedPackages: astAnalysis.affectedPackages,
		affectedSourceFiles: astAnalysis.affectedSourceFiles,
		usageCount: astAnalysis.usageCount,
	};
};
