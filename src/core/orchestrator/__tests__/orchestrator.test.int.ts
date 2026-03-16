import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReleaseNotesForDependency } from "../../../clients/changelog.js";
import { getLatestVersion, isUpdateNeeded } from "../../../clients/npm.js";
import { createProject, extractDependencyUsages } from "../../ast/ast.js";
import {
	type PackageJson,
	scanTypeScriptFiles,
	scanWorkspace,
} from "../../scanner/scanner.js";
import { analyzeMonorepoDrift } from "../orchestrator.js";

// Mocking the external boundaries and slow file systems for offline integration test
vi.mock("../../scanner/scanner.js");
vi.mock("../../../clients/npm.js");
vi.mock("../../../clients/changelog.js");
vi.mock("../../ast/ast.js");

const mockWorkspaceRoot = "/fake/monorepo";
const mockGithubToken = "ghp_test_token";

describe("analyzeMonorepoDrift - Integration Workflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Mock the AST Extraction logic
		const mockProject = {
			addSourceFilesAtPaths: vi.fn(),
			getSourceFiles: vi.fn().mockReturnValue(["fakeFile1.ts"]),
			removeSourceFile: vi.fn(),
		};
		vi.mocked(createProject).mockReturnValue(mockProject as any);
		vi.mocked(extractDependencyUsages).mockImplementation((file, dep) => {
			return {
				file: file as unknown as string,
				importStatement: `import { x } from "${dep}";`,
				usages: [
					{
						statement: "x()",
						line: 10,
						enclosingFunction: null,
						localCallers: [],
					},
				],
			};
		});

		// Mock release notes fetcher
		vi.mocked(getReleaseNotesForDependency).mockResolvedValue(
			"## Breaking Changes\n- New JSX Transform required",
		);
	});

	it("should detect drift across multiple packages and group into a single payload per dependency", async () => {
		// 1. Mock the Workspace Scanner returning 2 packages sharing 2 dependencies.
		// One dependency drifts ('react'), the other stays the same ('lodash').
		vi.mocked(scanWorkspace).mockResolvedValue(
			new Map([
				[
					"/fake/monorepo/apps/web/package.json",
					{
						name: "web",
						version: "1.0.0",
						description: "Main web application",
						dependencies: { react: "^18.0.0", lodash: "^4.17.21" },
					} as PackageJson,
				],
				[
					"/fake/monorepo/apps/api/package.json",
					{
						name: "api",
						version: "1.0.0",
						description: "REST API server",
						dependencies: { react: "18.2.0" },
					} as PackageJson,
				],
			]),
		);

		// 2. Mock TypeScript file discovery
		vi.mocked(scanTypeScriptFiles).mockImplementation(async (pkgRoot) => {
			if (pkgRoot.includes("web"))
				return ["/fake/monorepo/apps/web/src/index.tsx"];
			return ["/fake/monorepo/apps/api/src/index.ts"];
		});

		// 3. Mock npm registry answering versions
		vi.mocked(getLatestVersion).mockImplementation(async (dep) => {
			if (dep === "react") return "19.0.0"; // Drift!
			if (dep === "lodash") return "4.17.21"; // No drift
			return "0.0.0";
		});

		// 4. Mock the internal npm helper used by the aggregator
		const { getExternalDependencies } = await import("../../../clients/npm.js");
		vi.mocked(getExternalDependencies).mockImplementation((pkg) => {
			return Object.keys(pkg.dependencies || {});
		});

		// 5. Mock isUpdateNeeded to explicitly bypass logic for the test
		vi.mocked(isUpdateNeeded).mockImplementation((_current, latest) => {
			return latest === "19.0.0"; // Only react drifts
		});

		// Execute the orchestrator
		const drifts = await analyzeMonorepoDrift(
			mockWorkspaceRoot,
			mockGithubToken,
		);

		// Assertions

		// It should only report 'react' because 'lodash' did not drift
		expect(drifts).toHaveLength(1);
		const reactDrift = drifts[0];
		expect(reactDrift).toBeDefined();
		if (!reactDrift) throw new Error("Expected reactDrift to be defined");

		expect(reactDrift.dependencyName).toBe("react");
		expect(reactDrift.latestVersion).toBe("19.0.0");

		// Verify release notes are attached
		expect(reactDrift.releaseNotes).toContain("Breaking Changes");

		// It aggregated the current versions correctly
		expect(reactDrift.currentVersions).toEqual(new Set(["^18.0.0", "18.2.0"]));

		// It aggregated 2 payloads within the ONE dependency report (ChatOps rule)
		expect(reactDrift.payloads).toHaveLength(2);
		expect(reactDrift.payloads[0]?.package.packageName).toBe("web");
		expect(reactDrift.payloads[0]?.package.serviceDescription).toBe(
			"Main web application",
		);
		expect(reactDrift.payloads[1]?.package.packageName).toBe("api");
		expect(reactDrift.payloads[1]?.package.serviceDescription).toBe(
			"REST API server",
		);

		// Validate memory-safe AST footprint
		const mockProject = vi.mocked(createProject).mock.results[0]?.value;
		expect(mockProject.addSourceFilesAtPaths).toHaveBeenCalledTimes(2);
		// Crucially, it must remove the source file to prevent memory leaks
		expect(mockProject.removeSourceFile).toHaveBeenCalledTimes(2);

		// Verify release notes were fetched for the drifted dependency
		expect(getReleaseNotesForDependency).toHaveBeenCalledWith(
			mockGithubToken,
			"react",
			"19.0.0",
		);
	});
});
