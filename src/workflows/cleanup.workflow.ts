import * as core from "@actions/core";
import { deleteJulesSession } from "../clients/jules.js";
import { extractLegacyJulesSessionId } from "../core/orchestrator/issue-context.js";

export const handleIssueClosedWorkflow = async (
	julesApiKey: string,
	issueBody: string | undefined,
): Promise<void> => {
	const sessionName = extractLegacyJulesSessionId(issueBody);
	if (sessionName) {
		core.info(
			`🧹 Manual issue closure detected. Cleaning up Jules session: ${sessionName}`,
		);
		await deleteJulesSession(julesApiKey, sessionName).catch(() => {});
	}
};
