import * as core from "@actions/core";
import * as github from "@actions/github";
import { getIssueBody } from "../clients/github.js";
import { handleCloseCommand } from "../commands/close.command.js";
import { handleFixCommand } from "../commands/fix.command.js";
import { extractLegacyJulesSessionId } from "../core/orchestrator/issue-context.js";

const isAuthorized = (
	actor: string,
	association: string | undefined,
): boolean => {
	const authorizedAssociations = ["OWNER", "MEMBER", "COLLABORATOR"];
	if (association && authorizedAssociations.includes(association)) {
		return true;
	}
	core.warning(
		`🚫 @${actor} (${association}) is unauthorized to trigger code generation.`,
	);
	return false;
};

export const handleIssueCommentWorkflow = async (
	githubToken: string,
	julesApiKey: string,
	coreFrameworks: ReadonlySet<string>,
): Promise<void> => {
	const payload = github.context.payload;
	const commentBody = payload.comment?.body || "";
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

	if (!isAuthorized(actor, association)) {
		const octokit = github.getOctokit(githubToken);
		const { owner, repo } = github.context.repo;
		await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body: `🚫 **Access Denied**: @${actor}, you must have \`write\` or \`admin\` permissions to trigger depSync automation.`,
		});
		return;
	}

	core.info(
		`🛠️ Detected ${isFix ? "/fix" : "/close"} command from @${actor} on issue #${issueNumber}`,
	);

	const issueBody = await getIssueBody(githubToken, issueNumber);

	if (isFix) {
		await handleFixCommand(
			githubToken,
			julesApiKey,
			issueBody,
			issueNumber,
			commentId,
			coreFrameworks,
		);
		return;
	}

	await handleCloseCommand(
		githubToken,
		julesApiKey,
		extractLegacyJulesSessionId(issueBody) ?? undefined,
		issueNumber,
		commentId,
	);
};
