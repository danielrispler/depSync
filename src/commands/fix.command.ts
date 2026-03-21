import * as core from "@actions/core";
import * as github from "@actions/github";
import { addCommentReaction } from "../clients/github.js";
import {
	createJulesFixSession,
	deleteJulesSession,
	extractPullRequestOutput,
	resolveJulesSource,
	runJulesSessionWithRetry,
} from "../clients/jules.js";
import { parseIssueContext } from "../core/orchestrator/issue-context.js";
import { rebuildDriftFromIssueContext } from "../core/orchestrator/orchestrator.js";

interface CommandContext {
	githubToken: string;
	issueNumber: number;
	commentId: number;
	octokit: ReturnType<typeof github.getOctokit>;
	repo: typeof github.context.repo;
}

const notifyStart = async (ctx: CommandContext): Promise<void> => {
	const { octokit, repo, issueNumber, commentId } = ctx;
	await addCommentReaction(ctx.githubToken, commentId, "eyes");
	await octokit.rest.issues.createComment({
		owner: repo.owner,
		repo: repo.repo,
		issue_number: issueNumber,
		body: "🚀 depSync is rebuilding focused context and launching Jules in zero-touch mode to export the fix PR natively...",
	});
};

const notifySuccess = async (
	ctx: CommandContext,
	pullRequest: { url: string; title: string },
): Promise<void> => {
	const { octokit, repo, issueNumber } = ctx;
	await octokit.rest.issues.createComment({
		owner: repo.owner,
		repo: repo.repo,
		issue_number: issueNumber,
		body: `✅ Jules exported the fix PR natively: [${pullRequest.title}](${pullRequest.url})`,
	});
};

const handleFailure = async (
	ctx: CommandContext,
	message: string,
): Promise<void> => {
	const { octokit, repo, issueNumber } = ctx;
	core.error(`❌ Failed /fix flow: ${message}`);
	await octokit.rest.issues.createComment({
		owner: repo.owner,
		repo: repo.repo,
		issue_number: issueNumber,
		body: `❌ **Autonomous /fix session failed**: ${message}`,
	});
};

const cleanup = async (
	julesApiKey: string,
	sessionName: string | undefined,
): Promise<void> => {
	if (!sessionName) return;

	core.info("🧹 Cleaning up Jules session...");
	await deleteJulesSession(julesApiKey, sessionName).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		core.warning(`Cleanup failed: ${message}`);
	});
};

export const handleFixCommand = async (
	githubToken: string,
	julesApiKey: string,
	issueBody: string,
	issueNumber: number,
	commentId: number,
	coreFrameworks: ReadonlySet<string>,
): Promise<void> => {
	const context: CommandContext = {
		githubToken,
		issueNumber,
		commentId,
		octokit: github.getOctokit(githubToken),
		repo: github.context.repo,
	};

	let sessionName: string | undefined;

	try {
		await notifyStart(context);

		const issueContext = parseIssueContext(issueBody);
		const drift = await rebuildDriftFromIssueContext(
			issueContext,
			githubToken,
			coreFrameworks,
		);
		const source = await resolveJulesSource(
			julesApiKey,
			context.repo.owner,
			context.repo.repo,
		);

		const session = await runJulesSessionWithRetry(julesApiKey, (deps) =>
			createJulesFixSession(julesApiKey, source, drift, deps),
		);
		sessionName = session.name;
		const pullRequest = extractPullRequestOutput(session);
		await notifySuccess(context, pullRequest);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await handleFailure(context, message);
	} finally {
		await cleanup(julesApiKey, sessionName);
	}
};
