import * as core from "@actions/core";
import * as github from "@actions/github";
import { reportDriftAsIssue } from "../clients/github.js";
import {
	createJulesAnalysisSession,
	deleteJulesSession,
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

const buildIssueAnalysis = async (
	julesApiKey: string,
	sessionName: string,
	drift: AggregatedDrift,
): Promise<DepSyncIssueAnalysis> => {
	const sessionSummary = await summarizeJulesSession(
		julesApiKey,
		sessionName,
	).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		core.warning(
			`Could not summarize Jules session ${sessionName}: ${message}`,
		);
		return { activityCount: 0, signals: [] };
	});

	const riskLevel = calculateRiskLevel(
		drift.updateType,
		drift.affectedPackages.length,
		drift.usageCount,
	);
	const releaseNotesSummary = summarizeReleaseNotes(drift.releaseNotes);
	const issueSummary = `${drift.dependencyName} affects ${drift.affectedPackages.length} package(s) across ${drift.affectedSourceFiles.length} file(s) with ${riskLevel} migration risk.`;
	const julesSignals = sessionSummary.signals.length
		? sessionSummary.signals.map((signal) => `- ${signal}`).join("\n")
		: "- Jules returned no structured progress text for this short-lived session.";

	const releaseNotesSection = releaseNotesSummary
		? `### Release Notes Signal\n- ${releaseNotesSummary}`
		: `### Release Notes Signal\n- No release notes were available for \`${drift.latestVersion}\`.`;

	return {
		riskLevel,
		issueSummary,
		executionMetadata: {
			generatedAt: new Date().toISOString(),
			affectedFileCount: drift.affectedSourceFiles.length,
			affectedPackageCount: drift.affectedPackages.length,
			julesActivityCount: sessionSummary.activityCount,
		},
		markdown: `### Summary
${issueSummary}

### Risk
- This update is classified as **${riskLevel}** risk based on semver impact and AST footprint.
- depSync found ${drift.usageCount} relevant usage site(s) across ${drift.affectedSourceFiles.length} focused file(s).

${releaseNotesSection}

### Jules Signals
${julesSignals}

### Recommended Migration Focus
- Start with the affected files already captured in this issue context.
- Validate exported APIs before merging if any downstream signature changes are required.`,
	};
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
	const notificationDigest: NotificationDigestItem[] = [];

	for (const drift of drifts) {
		let sessionName: string | undefined;

		try {
			core.info(
				`🤖 Opening Jules analysis session for ${drift.dependencyName}...`,
			);
			const session = await createJulesAnalysisSession(
				julesApiKey,
				owner,
				repo,
				drift,
			);
			sessionName = session.name;

			const analysis = await buildIssueAnalysis(
				julesApiKey,
				session.name,
				drift,
			);

			core.info(`📅 Opening GitHub issue for ${drift.dependencyName}...`);
			const issue = await reportDriftAsIssue(githubToken, drift, analysis);

			notificationDigest.push({
				packageName: drift.dependencyName,
				riskLevel: analysis.riskLevel,
				issueUrl: issue.url,
				summary: analysis.issueSummary,
			});

			core.info(`✔ Successfully processed ${drift.dependencyName}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			core.error(`❌ Failed processing ${drift.dependencyName}: ${message}`);
		} finally {
			if (sessionName) {
				await deleteJulesSession(julesApiKey, sessionName).catch((error) => {
					const message =
						error instanceof Error ? error.message : String(error);
					core.warning(
						`Failed to clean up Jules session ${sessionName}: ${message}`,
					);
				});
			}
		}
	}

	await sendNotification(notificationWebhookUrl, notificationWebhookSecret, {
		repository: `${owner}/${repo}`,
		generatedAt: new Date().toISOString(),
		issues: notificationDigest,
	});
};
