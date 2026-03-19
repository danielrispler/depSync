import type { DepSyncIssueContext } from "../../types/drift.js";

export type DepSyncContextParseErrorCode =
	| "missing_comment"
	| "invalid_json"
	| "invalid_schema";

export class DepSyncContextParseError extends Error {
	readonly code: DepSyncContextParseErrorCode;

	constructor(code: DepSyncContextParseErrorCode, message: string) {
		super(message);
		this.name = "DepSyncContextParseError";
		this.code = code;
	}
}

const CONTEXT_COMMENT_PATTERN = /<!--\s*depsync-context:\s*([\s\S]*?)\s*-->/;
const LEGACY_JULES_SESSION_PATTERN =
	/<!--\s*jules-session-id:\s*(sessions\/[^ ]+)\s*-->/;

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.every((entry) => typeof entry === "string" && entry.length > 0);

const isContextShape = (value: unknown): value is DepSyncIssueContext => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const context = value as Partial<DepSyncIssueContext>;

	return (
		context.schemaVersion === 1 &&
		typeof context.dependencyName === "string" &&
		isStringArray(context.currentVersions) &&
		typeof context.latestVersion === "string" &&
		Array.isArray(context.affectedPackages) &&
		context.affectedPackages.every(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.packageName === "string" &&
				typeof entry.packageJsonPath === "string",
		) &&
		Array.isArray(context.affectedSourceFiles) &&
		context.affectedSourceFiles.every(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.packageJsonPath === "string" &&
				typeof entry.filePath === "string",
		) &&
		(context.riskLevel === "low" ||
			context.riskLevel === "medium" ||
			context.riskLevel === "high") &&
		typeof context.issueSummary === "string" &&
		typeof context.executionMetadata === "object" &&
		context.executionMetadata !== null &&
		typeof context.executionMetadata.generatedAt === "string" &&
		typeof context.executionMetadata.affectedFileCount === "number" &&
		typeof context.executionMetadata.affectedPackageCount === "number"
	);
};

export const formatIssueContextComment = (
	context: DepSyncIssueContext,
): string => {
	const serialized = JSON.stringify(context);

	if (serialized.length > 20_000) {
		throw new Error("depSync issue context exceeded the safe size budget.");
	}

	return `<!-- depsync-context: ${serialized} -->`;
};

export const parseIssueContext = (issueBody: string): DepSyncIssueContext => {
	const match = issueBody.match(CONTEXT_COMMENT_PATTERN);
	if (!match?.[1]) {
		throw new DepSyncContextParseError(
			"missing_comment",
			"Could not find depSync context comment in the issue body.",
		);
	}

	try {
		const parsed: unknown = JSON.parse(match[1]);
		if (!isContextShape(parsed)) {
			throw new DepSyncContextParseError(
				"invalid_schema",
				"depSync context JSON does not match the expected schema.",
			);
		}

		return parsed;
	} catch (error) {
		if (error instanceof DepSyncContextParseError) {
			throw error;
		}

		throw new DepSyncContextParseError(
			"invalid_json",
			"depSync context JSON is malformed.",
		);
	}
};

export const extractLegacyJulesSessionId = (
	issueBody: string | undefined,
): string | null => {
	if (!issueBody) return null;

	const match = issueBody.match(LEGACY_JULES_SESSION_PATTERN);
	return match?.[1] ?? null;
};
