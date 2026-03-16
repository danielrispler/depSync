import * as core from "@actions/core";
import { addCommentReaction, closeIssue } from "../clients/github.js";
import { deleteJulesSession } from "../clients/jules.js";
import { sendNotification } from "../clients/notifier.js";

export const handleCloseCommand = async (
	githubToken: string,
	julesApiKey: string,
	sessionName: string,
	issueNumber: number,
	commentId: number,
	webhookUrl: string | undefined,
) => {
	try {
		await addCommentReaction(githubToken, commentId, "rocket");
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
