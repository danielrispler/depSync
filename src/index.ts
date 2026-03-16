import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import {
	addCommentReaction,
	closeIssue,
	reportDriftAsIssue,
} from "./clients/github.js";
import {
	createJulesSession,
	deleteJulesSession,
	sendJulesMessage,
} from "./clients/jules.js";
import { sendNotification } from "./clients/notifier.js";
import { analyzeMonorepoDrift } from "./core/orchestrator/orchestrator.js";

const handleScanWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	webhookUrl: string | undefined,
	workspaceRoot: string,
) => {
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

const isAuthorized = (actor: string, association: string | undefined) => {
	const authorizedAssociations = ["OWNER", "MEMBER", "COLLABORATOR"];
	if (association && authorizedAssociations.includes(association)) {
		return true;
	}
	core.warning(
		`🚫 @${actor} (${association}) is unauthorized to trigger code generation.`,
	);
	return false;
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
	const commentId = payload.comment?.id;
	const actor = github.context.actor;
	const association = payload.comment?.author_association;

	const isFix = commentBody.includes("/fix");
	const isClose = commentBody.includes("/close");

	if (!isFix && !isClose) {
		core.info("Comment does not contain ChatOps command. Ignoring.");
		return;
	}

	if (!issueNumber || !commentId) {
		core.error("Could not determine issue or comment details from payload.");
		return;
	}

	// 1. Authorization Guard
	if (!isAuthorized(actor, association)) {
		const octokit = github.getOctokit(githubToken);
		const { owner, repo } = github.context.repo;
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `🚫 **Access Denied**: @${actor}, you must have \`write\` or \`admin\` permissions to trigger Jules AI via depSync.`,
		});
		return;
	}

	core.info(
		`🛠️ Detected ${isFix ? "/fix" : "/close"} command from @${actor} on issue #${issueNumber}`,
	);

	// 2. Stateless Session Recovery
	const sessionMatch = issueBody.match(
		/<!-- jules-session-id: (sessions\/[^ ]+) -->/,
	);
	if (!sessionMatch || !sessionMatch[1]) {
		core.error("❌ Could not recover Jules session ID.");
		return;
	}
	const sessionName = sessionMatch[1];

	if (isFix) {
		await handleFixCommand(
			githubToken,
			julesApiKey,
			sessionName,
			issueNumber,
			commentId,
			webhookUrl,
		);
	} else if (isClose) {
		await handleCloseCommand(
			githubToken,
			julesApiKey,
			sessionName,
			issueNumber,
			commentId,
			webhookUrl,
		);
	}
};

const handleFixCommand = async (
	githubToken: string,
	julesApiKey: string,
	sessionName: string,
	issueNumber: number,
	commentId: number,
	webhookUrl: string | undefined,
) => {
	const octokit = github.getOctokit(githubToken);
	const { owner, repo } = github.context.repo;

	try {
		await addCommentReaction(githubToken, commentId, "eyes");
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `🚀 Jules AI is generating code fixes and preparing a Pull Request...`,
		});

		// 1. Get fixes from Jules
		const fixes = await sendJulesMessage(
			julesApiKey,
			sessionName,
			"Generate a Pull Request fixing the outlined breaking changes.",
		);

		// 2. Apply fixes & Git Ops
		const branchName = `depsync/fix-issue-${issueNumber}`;

		core.info("🔧 Configuring Git user...");
		execSync('git config user.name "depSync Bot"');
		execSync('git config user.email "bot@depsync.ai"');

		core.info(`🌿 Creating branch ${branchName}...`);
		execSync(`git checkout -b ${branchName}`);

		for (const fix of fixes) {
			core.info(`📝 Applying fix to ${fix.filePath}...`);
			fs.writeFileSync(fix.filePath, fix.fileContent);
		}

		core.info("💾 Committing changes...");
		execSync("git add .");
		execSync('git commit -m "chore: automated dependency fix by depSync"');

		core.info("⬆️ Pushing changes...");
		const remoteUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;
		execSync(`git push "${remoteUrl}" ${branchName} --force`);

		// 3. Create PR
		core.info("🎁 Creating Pull Request...");
		const { data: pr } = await octokit.rest.pulls.create({
			owner,
			repo,
			title: `[depSync] Fix for Issue #${issueNumber}`,
			head: branchName,
			base: "main",
			body: `This PR was automatically generated by Jules AI in response to issue #${issueNumber}.\n\nCloses #${issueNumber}`,
		});

		await sendNotification(
			webhookUrl,
			`✅ Jules AI created PR #${pr.number} for issue #${issueNumber}.`,
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		core.error(`❌ Failed /fix flow: ${msg}`);
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `❌ **Failed to generate PR**: ${msg}`,
		});
	} finally {
		// ALWAYS cleanup
		core.info("🧹 Cleaning up Jules session and closing issue...");
		await deleteJulesSession(julesApiKey, sessionName).catch((e) =>
			core.warning(`Cleanup failed: ${e.message}`),
		);
		await closeIssue(githubToken, issueNumber);
	}
};

const handleCloseCommand = async (
	githubToken: string,
	julesApiKey: string,
	sessionName: string,
	issueNumber: number,
	commentId: number,
	webhookUrl: string | undefined,
) => {
	try {
		await addCommentReaction(githubToken, commentId, "rocket"); // Closest to 🧹 in standard reactions? Or just rocket.
		await deleteJulesSession(julesApiKey, sessionName);
		await closeIssue(githubToken, issueNumber);
		await sendNotification(
			webhookUrl,
			`🧹 Jules session for issue #${issueNumber} has been terminated.`,
		);
	} catch (error) {
		core.error(`❌ Failed /close flow: ${error}`);
	}
};

const handleIssueClosedWorkflow = async (
	julesApiKey: string,
	issueBody: string | undefined,
) => {
	if (!issueBody) return;
	const sessionMatch = issueBody.match(
		/<!-- jules-session-id: (sessions\/[^ ]+) -->/,
	);
	if (sessionMatch?.[1]) {
		const sessionName = sessionMatch[1];
		core.info(
			`🧹 Manual issue closure detected. Cleaning up Jules session: ${sessionName}`,
		);
		await deleteJulesSession(julesApiKey, sessionName).catch(() => { });
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
