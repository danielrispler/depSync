import { dirname } from "node:path";
import { getLatestVersion, isUpdateNeeded } from "../../clients/npm.js";
import { createProject, extractDependencyUsages } from "../ast/ast.js";
import { scanTypeScriptFiles, scanWorkspace } from "../scanner/scanner.js";
import {
	type AggregatedDrift,
	buildDependencyMap,
	buildPackagePayload,
	type GeminiPromptPayload,
} from "./orchestrator.utils.js";

// ------------------------------------------------------------------
// Public Orchestrator Functions
// ------------------------------------------------------------------

/**
 * Main Orchestrator Pipeline
 * 1. Scans workspace for packages.
 * 2. Inverts dependency mappings to group by DependencyName.
 * 3. (Drafted) Fetches latest versions & compares drift.
 * 4. (Drafted) Discovers TS files and performs AST extraction.
 */
export const analyzeMonorepoDrift = async (
	workspaceRoot: string,
): Promise<AggregatedDrift[]> => {
	// Step 1: Discover all package.json files
	const packages = await scanWorkspace(workspaceRoot);

	// Step 2: Aggregate by external dependency
	const dependencyMap = buildDependencyMap(packages);

	const drifts: AggregatedDrift[] = [];

	// Optional optimization: If we had a batch endpoint, we could fetch all at once.
	// For now, we fetch latest versions sequentially to avoid spamming the registry
	// if there are hundreds of dependencies.
	for (const [dep, usages] of dependencyMap.entries()) {
		try {
			const latestVersion = await getLatestVersion(dep);
			const outdatedUsages = usages.filter((u) =>
				isUpdateNeeded(u.currentVersion, latestVersion),
			);

			if (outdatedUsages.length === 0) continue;

			// We have a drifted dependency!
			const currentVersions = new Set(
				outdatedUsages.map((u) => u.currentVersion),
			);
			const payloads: GeminiPromptPayload[] = [];

			// Create a lightweight, ephemeral Project for just this dependency's update cycle
			const project = createProject();

			for (const { path: pkgPath, pkg, currentVersion } of outdatedUsages) {
				const packageRoot = dirname(pkgPath);
				const tsFiles = await scanTypeScriptFiles(packageRoot);

				// Add files to project (in-memory)
				project.addSourceFilesAtPaths(tsFiles);

				const packagePayload = buildPackagePayload(
					pkgPath,
					pkg,
					dep,
					currentVersion,
					latestVersion,
				);

				// Extract AST context for this specific dependency
				for (const sourceFile of project.getSourceFiles()) {
					const usage = extractDependencyUsages(sourceFile, dep);
					if (usage) {
						packagePayload.usages.push(usage);
					}
				}

				if (packagePayload.usages.length > 0) {
					payloads.push(packagePayload);
				}

				// CRITICAL: Clear memory after processing this package to prevent heap explosion
				// on massive monorepos. We drop the source files so the GC can claim them.
				for (const sourceFile of project.getSourceFiles()) {
					project.removeSourceFile(sourceFile);
				}
			}

			// In ts-morph 20+, calling removeSourceFile on all files is sufficient
			// for memory clearing without a dedicated dispose() method.

			if (payloads.length > 0) {
				drifts.push({
					dependencyName: dep,
					currentVersions,
					latestVersion,
					payloads,
				});
			}
		} catch (error) {
			// If npm fetch fails for a single package (e.g., private registry without auth),
			// log safely and continue with the rest of the monorepo instead of crashing entirely.
			console.error(`Failed to analyze drift for dependency ${dep}:`, error);
		}
	}

	return drifts;
};
