import * as core from "@actions/core";

export interface NotifierDependencies {
	fetch: typeof fetch;
	warning: typeof core.warning;
}

const defaultDependencies: NotifierDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
	warning: core.warning,
};

/**
 * Sends a simple, unified push notification payload to a generic webhook URL.
 * Designed to be compatible with Discord, Slack, or generic catchers.
 *
 * Fails gracefully: If the webhook fails, the core action still succeeds.
 */
export const sendNotification = async (
	webhookUrl: string | undefined,
	message: string,
	deps: NotifierDependencies = defaultDependencies,
): Promise<void> => {
	if (!webhookUrl) return;

	try {
		const response = await deps.fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ text: message, content: message }),
		});

		if (!response.ok) {
			deps.warning(
				`Webhook notification failed with status: ${response.status}`,
			);
		}
	} catch (error) {
		// Swallow the network error gracefully to not crash the GitHub Action
		const msg = error instanceof Error ? error.message : String(error);
		deps.warning(`Failed to send webhook notification: ${msg}`);
	}
};
