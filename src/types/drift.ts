import type { DependencyUsage } from "../core/ast/ast.js";

export const UpdateType = {
	MAJOR: 0,
	MINOR: 1,
	PATCH: 2,
} as const;

export type UpdateType = (typeof UpdateType)[keyof typeof UpdateType];

export interface UpdateContext {
	dependencyName: string;
	currentVersion: string;
	latestVersion: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface AggregatedDrift {
	dependencyName: string;
	currentVersions: Set<string>;
	latestVersion: string;
	payloads: GeminiPromptPayload[];
	/** GitHub release notes for the target version, truncated to 3k chars */
	releaseNotes: string | null;
	driftWeight: number;
	updateType: UpdateType;
	affectedPackages: AffectedPackagePointer[];
	affectedSourceFiles: AffectedSourceFilePointer[];
	usageCount: number;
}

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

export interface GeminiPromptPayload {
	/** Metadata and domain context about the workspace package being updated */
	package: PackageContext;
	/** Details about the dependency that is changing */
	update: UpdateContext;
	/** The AST analysis of precisely how this dependency is used in this package */
	usages: DependencyUsage[];
}

export interface AffectedPackagePointer {
	packageName: string;
	packageJsonPath: string;
}

export interface AffectedSourceFilePointer {
	packageJsonPath: string;
	filePath: string;
}

export interface DepSyncIssueExecutionMetadata {
	generatedAt: string;
	affectedFileCount: number;
	affectedPackageCount: number;
	julesActivityCount?: number;
}

export interface DepSyncIssueContext {
	schemaVersion: 1;
	dependencyName: string;
	currentVersions: string[];
	latestVersion: string;
	affectedPackages: AffectedPackagePointer[];
	affectedSourceFiles: AffectedSourceFilePointer[];
	riskLevel: RiskLevel;
	issueSummary: string;
	executionMetadata: DepSyncIssueExecutionMetadata;
}

export interface DepSyncIssueAnalysis {
	markdown: string;
	riskLevel: RiskLevel;
	issueSummary: string;
	executionMetadata: DepSyncIssueExecutionMetadata;
}

export interface NotificationDigestItem {
	packageName: string;
	riskLevel: RiskLevel;
	issueUrl: string;
	summary: string;
}
