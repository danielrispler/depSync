import * as core from "@actions/core";
import * as github from "@actions/github";
import { reportDriftAsIssue } from "./clients/github.js";
import { createJulesSession, sendJulesMessage } from "./clients/jules.js";
import { sendNotification } from "./clients/notifier.js";
import { analyzeMonorepoDrift } from "./core/orchestrator/orchestrator.js";

const handleScanWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	webhookUrl: string | undefined,
	workspaceRoot: string,
) => {
	core.info(`🚀 depSync: Starting monorepo analysis...`);
	const drifts = await analyzeMonorepoDrift(workspaceRoot);

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
				drift.dependencyName,
				drift.payloads[0],
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

const handleIssueCommentWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	webhookUrl: string | undefined,
) => {
	const payload = github.context.payload;
	const commentBody = payload.comment?.body || "";
	const issueBody = payload.issue?.body || "";
	const issueNumber = payload.issue?.number;
	const actor = github.context.actor;

	if (!commentBody.includes("/fix")) {
		core.info("Comment does not contain /fix command. Ignoring.");
		return;
	}

	if (!issueNumber) {
		core.error("Could not determine issue number from payload.");
		return;
	}

	core.info(`🛠️ Detected /fix command from @${actor} on issue #${issueNumber}`);

	// 1. ChatOps Security (Authorization Guard)
	const octokit = github.getOctokit(githubToken);
	const { owner, repo } = github.context.repo;

	try {
		const { data: permissionData } =
			await octokit.rest.repos.getCollaboratorPermissionLevel({
				owner,
				repo,
				username: actor,
			});

		const permission = permissionData.permission;
		if (permission !== "admin" && permission !== "write") {
			core.warning(`🚫 @${actor} is unauthorized to trigger code generation.`);
			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: issueNumber,
				body: `🚫 **Access Denied**: @${actor}, you must have \`write\` or \`admin\` permissions to trigger Jules AI code generation via depSync.`,
			});
			return; // Gracefully exit
		}
		core.info(`✅ @${actor} is authorized (${permission}).`);
	} catch (_error) {
		core.error(
			`Failed to verify permissions for @${actor}. Aborting to be safe.`,
		);
		return;
	}

	// 2. Stateless Session Recovery
	// The session name is embedded dynamically in the issue body by github.ts:
	// <!-- jules-session-id: sessions/123XYZ -->
	const sessionMatch = issueBody.match(
		/<!-- jules-session-id: (sessions\/[^ ]+) -->/,
	);
	if (!sessionMatch || !sessionMatch[1]) {
		core.error(
			"❌ Could not recover Jules session ID from the issue body. The HTML comment may be missing or malformed.",
		);
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `❌ **Failed to generate PR**: Could not recover the Jules Session ID from this issue's body.`,
		});
		return;
	}

	const sessionName = sessionMatch[1];
	core.info(`♻️ Recovered Jules Session: ${sessionName}`);

	// 3. Trigger Jules PR Generation
	try {
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `🚀 Jules AI has been triggered! Generating Pull Request...`,
		});

		await sendJulesMessage(
			julesApiKey,
			sessionName,
			"Generate a Pull Request fixing the outlined breaking changes.",
		);

		await sendNotification(
			webhookUrl,
			`🛠️ Jules AI is generating a PR for issue #${issueNumber} triggered by @${actor}.`,
		);
		core.info(`✅ Successfully triggered Jules for session ${sessionName}.`);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		core.error(`❌ Failed to send message to Jules: ${msg}`);
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `❌ **Jules AI Error**: Failed to generate PR. \n\n\`\`\`\n${msg}\n\`\`\``,
		});
	}
};

export const run = async (): Promise<void> => {
	try {
		const githubToken = core.getInput("github-token", { required: true });
		const julesApiKey = core.getInput("jules-api-key", { required: true });
		const webhookUrl = core.getInput("webhook-url"); // Optional
		const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();

		const eventName = github.context.eventName;

		core.info(`depSync triggered by event: ${eventName}`);

		if (eventName === "issue_comment") {
			await handleIssueCommentWorkflow(githubToken, julesApiKey, webhookUrl);
		} else {
			// e.g. schedule, push, workflow_dispatch
			await handleScanWorkflow(
				githubToken,
				julesApiKey,
				webhookUrl,
				workspaceRoot,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		core.setFailed(`depSync execution failed: ${message}`);
	}
};

run();
