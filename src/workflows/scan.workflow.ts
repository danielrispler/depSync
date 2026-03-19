import * as core from "@actions/core";
import * as github from "@actions/github";
import { reportDriftAsIssue } from "../clients/github.js";
import {
	createJulesAnalysisSession,
	deleteJulesSession,
	resolveJulesSource,
	runJulesSessionWithRetry,
	summarizeJulesSession,
} from "../clients/jules.js";
import { sendNotification } from "../clients/notifier.js";
import { analyzeMonorepoDrift } from "../core/orchestrator/orchestrator.js";
import { calculateRiskLevel } from "../core/orchestrator/orchestrator.utils.js";
import type {
	AggregatedDrift,
	DepSyncIssueAnalysis,
	NotificationDigestItem,
} from "../types/drift.js";

const summarizeReleaseNotes = (releaseNotes: string | null): string | null => {
	if (!releaseNotes) return null;

	const candidate = releaseNotes
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	return candidate ? candidate.slice(0, 180) : null;
};

const buildFallbackAnalysisMarkdown = (drift: AggregatedDrift): string => {
	const releaseNotesSummary = summarizeReleaseNotes(drift.releaseNotes);
	const riskLevel = calculateRiskLevel(
		drift.updateType,
		drift.affectedPackages.length,
		drift.usageCount,
	);

	const releaseNotesSection = releaseNotesSummary
		? `### Release Notes Signal\n- ${releaseNotesSummary}`
		: `### Release Notes Signal\n- No release notes were available for \`${drift.latestVersion}\`.`;

	return `### Summary
${drift.dependencyName} affects ${drift.affectedPackages.length} package(s) across ${drift.affectedSourceFiles.length} file(s).

### Risk
- This update is classified as **${riskLevel}** risk based on semver impact and AST footprint.
- depSync found ${drift.usageCount} relevant usage site(s) across ${drift.affectedSourceFiles.length} focused file(s).

${releaseNotesSection}

### Recommended Migration Focus
- Start with the affected files already captured in this issue context.
- Validate exported APIs before merging if any downstream signature changes are required.`;
};

const buildIssueAnalysis = (
	drift: AggregatedDrift,
	analysisMarkdown: string | null,
	activityCount: number,
): DepSyncIssueAnalysis => {
	const riskLevel = calculateRiskLevel(
		drift.updateType,
		drift.affectedPackages.length,
		drift.usageCount,
	);
	const issueSummary = `${drift.dependencyName} affects ${drift.affectedPackages.length} package(s) across ${drift.affectedSourceFiles.length} file(s) with ${riskLevel} migration risk.`;

	return {
		riskLevel,
		issueSummary,
		executionMetadata: {
			generatedAt: new Date().toISOString(),
			affectedFileCount: drift.affectedSourceFiles.length,
			affectedPackageCount: drift.affectedPackages.length,
			julesActivityCount: activityCount,
		},
		markdown: analysisMarkdown ?? buildFallbackAnalysisMarkdown(drift),
	};
};

const processDrift = async (
	githubToken: string,
	julesApiKey: string,
	drift: AggregatedDrift,
	source: Awaited<ReturnType<typeof resolveJulesSource>>,
): Promise<NotificationDigestItem> => {
	let sessionName: string | undefined;

	try {
		core.info(
			`🤖 Opening Jules analysis session for ${drift.dependencyName}...`,
		);
		const session = await runJulesSessionWithRetry(julesApiKey, (deps) =>
			createJulesAnalysisSession(julesApiKey, source, drift, deps),
		);
		sessionName = session.name;

		const sessionSummary = await summarizeJulesSession(
			julesApiKey,
			session.name,
		);
		const analysis = buildIssueAnalysis(
			drift,
			sessionSummary.analysisMarkdown,
			sessionSummary.activityCount,
		);

		core.info(`📅 Opening GitHub issue for ${drift.dependencyName}...`);
		const issue = await reportDriftAsIssue(githubToken, drift, analysis);

		core.info(`✔ Successfully processed ${drift.dependencyName}.`);
		return {
			packageName: drift.dependencyName,
			riskLevel: analysis.riskLevel,
			issueUrl: issue.url,
			summary: analysis.issueSummary,
		};
	} finally {
		if (sessionName) {
			await deleteJulesSession(julesApiKey, sessionName).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				core.warning(
					`Failed to clean up Jules session ${sessionName}: ${message}`,
				);
			});
		}
	}
};

export const handleScanWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	notificationWebhookUrl: string | undefined,
	notificationWebhookSecret: string | undefined,
	workspaceRoot: string,
	coreFrameworks: ReadonlySet<string>,
): Promise<void> => {
	core.info(`🚀 depSync: Starting monorepo analysis...`);
	const drifts = await analyzeMonorepoDrift(
		workspaceRoot,
		githubToken,
		coreFrameworks,
	);

	if (drifts.length === 0) {
		core.info("✅ No dependency drifts detected.");
		return;
	}

	core.info(`🔍 Found ${drifts.length} prioritized dependency drifts.`);
	const { owner, repo } = github.context.repo;
	const source = await resolveJulesSource(julesApiKey, owner, repo);

	const settledResults = await Promise.allSettled(
		drifts.map((drift) =>
			processDrift(githubToken, julesApiKey, drift, source),
		),
	);

	const notificationDigest: NotificationDigestItem[] = [];
	for (const result of settledResults) {
		if (result.status === "fulfilled") {
			notificationDigest.push(result.value);
			continue;
		}

		const message =
			result.reason instanceof Error
				? result.reason.message
				: String(result.reason);
		core.error(`❌ Failed processing drift worker: ${message}`);
	}

	await sendNotification(notificationWebhookUrl, notificationWebhookSecret, {
		repository: `${owner}/${repo}`,
		generatedAt: new Date().toISOString(),
		issues: notificationDigest,
	});
};
