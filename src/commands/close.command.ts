import * as core from "@actions/core";
import { addCommentReaction, closeIssue } from "../clients/github.js";
import { deleteJulesSession } from "../clients/jules.js";

export const handleCloseCommand = async (
	githubToken: string,
	julesApiKey: string,
	sessionName: string | undefined,
	issueNumber: number,
	commentId: number,
): Promise<void> => {
	try {
		await addCommentReaction(githubToken, commentId, "rocket");
		if (sessionName) {
			await deleteJulesSession(julesApiKey, sessionName);
		}
		await closeIssue(githubToken, issueNumber);
	} catch (error) {
		core.error(`❌ Failed /close flow: ${error}`);
	}
};
