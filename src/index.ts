import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadDepSyncConfig } from "./config/depsync.config.js";
import { handleIssueCommentWorkflow } from "./workflows/chatops.workflow.js";
import { handleIssueClosedWorkflow } from "./workflows/cleanup.workflow.js";
import { handleScanWorkflow } from "./workflows/scan.workflow.js";

export const run = async (): Promise<void> => {
	try {
		const githubToken = core.getInput("github-token", { required: true });
		const julesApiKey = core.getInput("jules-api-key", { required: true });
		const notificationWebhookUrl = core.getInput("notification-webhook-url");
		const notificationWebhookSecret = core.getInput(
			"notification-webhook-secret",
		);
		const coreFrameworksInput = core.getInput("core-frameworks");
		const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
		const depSyncConfig = await loadDepSyncConfig(
			workspaceRoot,
			coreFrameworksInput,
		);
		const coreFrameworks = new Set(depSyncConfig.coreFrameworks);

		const eventName = github.context.eventName;

		core.info(`depSync triggered by event: ${eventName}`);

		if (eventName === "issue_comment") {
			await handleIssueCommentWorkflow(
				githubToken,
				julesApiKey,
				coreFrameworks,
			);
		} else if (
			eventName === "issues" &&
			github.context.payload.action === "closed"
		) {
			await handleIssueClosedWorkflow(
				julesApiKey,
				github.context.payload.issue?.body,
			);
		} else {
			// e.g. schedule, push, workflow_dispatch
			await handleScanWorkflow(
				githubToken,
				julesApiKey,
				notificationWebhookUrl,
				notificationWebhookSecret,
				workspaceRoot,
				coreFrameworks,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		core.setFailed(`depSync execution failed: ${message}`);
	}
};

run();
