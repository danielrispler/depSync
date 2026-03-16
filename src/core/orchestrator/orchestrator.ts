import { dirname } from "node:path";
import { getReleaseNotesForDependency } from "../../clients/changelog.js";
import { getLatestVersion, isUpdateNeeded } from "../../clients/npm.js";
import type {
	AggregatedDrift,
	GeminiPromptPayload,
} from "../../types/drift.js";
import { createProject, extractDependencyUsages } from "../ast/ast.js";
import {
	type PackageJson,
	scanTypeScriptFiles,
	scanWorkspace,
} from "../scanner/scanner.js";
import {
	buildDependencyMap,
	buildPackagePayload,
	calculatePriorityScore,
	getUpdateType,
} from "./orchestrator.utils.js";

/**
 * Main Orchestrator Pipeline (Optimized)
 * 1. Scans workspace and detects drifts using local semver.
 * 2. Ranks drifts by Priority (Infra + Semver).
 * 3. Selects TOP 4 candidates FIRST.
 * 4. Only for the top 4: Fetches Release Notes and performs AST analysis.
 */
export const analyzeMonorepoDrift = async (
	workspaceRoot: string,
	githubToken: string,
): Promise<AggregatedDrift[]> => {
	const packages = await scanWorkspace(workspaceRoot);
	const dependencyMap = buildDependencyMap(packages);

	const initialDrifts: Array<{
		dep: string;
		priorityScore: number;
		currentVersions: Set<string>;
		latestVersion: string;
		usages: Array<{ path: string; pkg: PackageJson; currentVersion: string }>;
	}> = [];

	// Phase 1: Rank and Filter (Local Only)
	for (const [dep, usages] of dependencyMap.entries()) {
		try {
			const latestVersion = await getLatestVersion(dep);
			const outdatedUsages = usages.filter((u) =>
				isUpdateNeeded(u.currentVersion, latestVersion),
			);

			if (outdatedUsages.length === 0) continue;

			const currentVersions = new Set(
				outdatedUsages.map((u) => u.currentVersion),
			);
			const firstCurrent = Array.from(currentVersions)[0];
			const updateType = getUpdateType(firstCurrent, latestVersion);
			const priorityScore = calculatePriorityScore(dep, updateType);

			initialDrifts.push({
				dep,
				priorityScore,
				currentVersions,
				latestVersion,
				usages: outdatedUsages,
			});
		} catch (error) {
			console.error(`Failed npm check for ${dep}: ${error}`);
		}
	}

	// Sort and pick top 4
	const topDrifts = initialDrifts
		.sort((a, b) => a.priorityScore - b.priorityScore)
		.slice(0, 4);

	const finalDrifts: AggregatedDrift[] = [];

	// Phase 2: Expensive Analysis (Release Notes + AST) for Top 4 Only
	for (const drift of topDrifts) {
		try {
			const releaseNotes = await getReleaseNotesForDependency(
				githubToken,
				drift.dep,
				drift.latestVersion,
			);

			const payloads: GeminiPromptPayload[] = [];
			const project = createProject();

			for (const { path: pkgPath, pkg, currentVersion } of drift.usages) {
				const packageRoot = dirname(pkgPath);
				const tsFiles = await scanTypeScriptFiles(packageRoot);

				project.addSourceFilesAtPaths(tsFiles);

				const packagePayload = buildPackagePayload(
					pkgPath,
					pkg,
					drift.dep,
					currentVersion,
					drift.latestVersion,
				);

				for (const sourceFile of project.getSourceFiles()) {
					const usage = extractDependencyUsages(sourceFile, drift.dep);
					if (usage) {
						packagePayload.usages.push(usage);
					}
				}

				if (packagePayload.usages.length > 0) {
					payloads.push(packagePayload);
				}

				for (const sourceFile of project.getSourceFiles()) {
					project.removeSourceFile(sourceFile);
				}
			}

			if (payloads.length > 0) {
				finalDrifts.push({
					dependencyName: drift.dep,
					currentVersions: drift.currentVersions,
					latestVersion: drift.latestVersion,
					payloads,
					releaseNotes,
					priorityScore: drift.priorityScore,
				});
			}
		} catch (error) {
			console.error(`Failed deep analysis for ${drift.dep}: ${error}`);
		}
	}

	return finalDrifts;
};
