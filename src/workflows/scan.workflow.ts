import * as core from "@actions/core";
import * as github from "@actions/github";
import { reportDriftAsIssue } from "../clients/github.js";
import { createJulesSession } from "../clients/jules.js";
import { sendNotification } from "../clients/notifier.js";
import { analyzeMonorepoDrift } from "../core/orchestrator/orchestrator.js";

export const handleScanWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	webhookUrl: string | undefined,
	workspaceRoot: string,
): Promise<void> => {
	core.info(`🚀 depSync: Starting monorepo analysis...`);
	const drifts = await analyzeMonorepoDrift(workspaceRoot, githubToken);

	if (drifts.length === 0) {
		core.info("✅ No dependency drifts detected.");
		return;
	}

	core.info(`🔍 Found ${drifts.length} outdated external dependencies.`);
	const { owner, repo } = github.context.repo;

	for (const drift of drifts) {
		try {
			core.info(`🤖 Analyzing ${drift.dependencyName} with Jules AI...`);
			const julesSession = await createJulesSession(
				julesApiKey,
				owner,
				repo,
				drift,
			);

			core.info(`📅 Opening GitHub issue for ${drift.dependencyName}...`);
			await reportDriftAsIssue(githubToken, drift, julesSession);

			await sendNotification(
				webhookUrl,
				`🚨 depSync detected drift in \`${drift.dependencyName}\`. A new issue was opened with Jules AI analysis!`,
			);

			core.info(`✔ Successfully processed ${drift.dependencyName}.`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			core.error(`❌ Failed processing ${drift.dependencyName}: ${msg}`);
		}
	}
};
