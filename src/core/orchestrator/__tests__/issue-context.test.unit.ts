import { describe, expect, it } from "vitest";
import {
	DepSyncContextParseError,
	extractLegacyJulesSessionId,
	formatIssueContextComment,
	parseIssueContext,
} from "../issue-context.js";

describe("issue context parsing", () => {
	const context = {
		schemaVersion: 1 as const,
		dependencyName: "react",
		currentVersions: ["18.0.0"],
		latestVersion: "19.0.0",
		affectedPackages: [
			{
				packageName: "web",
				packageJsonPath: "/workspace/apps/web/package.json",
			},
		],
		affectedSourceFiles: [
			{
				packageJsonPath: "/workspace/apps/web/package.json",
				filePath: "/workspace/apps/web/src/index.tsx",
			},
		],
		riskLevel: "high" as const,
		issueSummary: "react affects one package.",
		executionMetadata: {
			generatedAt: "2026-03-19T12:00:00.000Z",
			affectedFileCount: 1,
			affectedPackageCount: 1,
		},
	};

	it("parses a valid hidden context payload", () => {
		const issueBody = `Header\n${formatIssueContextComment(context)}`;

		expect(parseIssueContext(issueBody)).toEqual(context);
	});

	it("throws a typed error when the hidden context is missing", () => {
		expect(() => parseIssueContext("plain issue body")).toThrowError(
			DepSyncContextParseError,
		);
		expect(() => parseIssueContext("plain issue body")).toThrow(
			/Could not find depSync context comment/,
		);
	});

	it("throws a typed error for malformed JSON", () => {
		expect(() =>
			parseIssueContext("<!-- depsync-context: {bad json} -->"),
		).toThrowError(DepSyncContextParseError);

		try {
			parseIssueContext("<!-- depsync-context: {bad json} -->");
		} catch (error) {
			expect((error as DepSyncContextParseError).code).toBe("invalid_json");
		}
	});

	it("throws a typed error for invalid schema", () => {
		try {
			parseIssueContext(
				'<!-- depsync-context: {"schemaVersion":1,"dependencyName":"react"} -->',
			);
		} catch (error) {
			expect((error as DepSyncContextParseError).code).toBe("invalid_schema");
		}
	});

	it("extracts the legacy session id when present", () => {
		expect(
			extractLegacyJulesSessionId(
				"<!-- jules-session-id: sessions/legacy-123 -->",
			),
		).toBe("sessions/legacy-123");
	});
});
