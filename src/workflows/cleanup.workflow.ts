import * as core from "@actions/core";
import { deleteJulesSession } from "../clients/jules.js";

export const handleIssueClosedWorkflow = async (
	julesApiKey: string,
	issueBody: string | undefined,
): Promise<void> => {
	if (!issueBody) return;
	const sessionMatch = issueBody.match(
		/<!-- jules-session-id: (sessions\/[^ ]+) -->/,
	);
	if (sessionMatch?.[1]) {
		const sessionName = sessionMatch[1];
		core.info(
			`🧹 Manual issue closure detected. Cleaning up Jules session: ${sessionName}`,
		);
		await deleteJulesSession(julesApiKey, sessionName).catch(() => {});
	}
};
