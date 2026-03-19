import { createHmac } from "node:crypto";
import * as core from "@actions/core";
import type { NotificationDigestItem } from "../types/drift.js";

export interface NotifierDependencies {
	fetch: typeof fetch;
	warning: typeof core.warning;
}

export interface NotificationDigestPayload {
	repository: string;
	generatedAt: string;
	issues: NotificationDigestItem[];
}

const defaultDependencies: NotifierDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
	warning: core.warning,
};

const createSignature = (
	body: string,
	secret: string | undefined,
): string | undefined => {
	if (!secret) return undefined;
	return createHmac("sha256", secret).update(body).digest("hex");
};

/**
 * Sends a single batched notification payload to a generic webhook.
 *
 * Fails gracefully: any network or non-2xx error is downgraded to a warning.
 */
export const sendNotification = async (
	webhookUrl: string | undefined,
	webhookSecret: string | undefined,
	payload: NotificationDigestPayload,
	deps: NotifierDependencies = defaultDependencies,
): Promise<void> => {
	if (!webhookUrl || payload.issues.length === 0) return;

	const body = JSON.stringify(payload);
	const signature = createSignature(body, webhookSecret);

	try {
		const response = await deps.fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(signature ? { "x-depsync-signature": signature } : {}),
			},
			body,
		});

		if (!response.ok) {
			deps.warning(
				`Notification webhook failed with status: ${response.status}`,
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.warning(`Failed to send notification webhook: ${message}`);
	}
};
