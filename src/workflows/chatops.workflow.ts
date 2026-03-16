import * as core from "@actions/core";
import * as github from "@actions/github";
import { handleCloseCommand } from "../commands/close.command.js";
import { handleFixCommand } from "../commands/fix.command.js";

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
	webhookUrl: string | undefined,
): Promise<void> => {
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
