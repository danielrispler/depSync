import type { GeminiPromptPayload } from "../core/orchestrator/orchestrator.utils.js";
import { buildGeminiPayload } from "../core/orchestrator/payload.js";

export interface JulesSessionRequest {
	title: string;
	prompt: string;
	sourceContext: {
		source: string;
		githubRepoContext: {
			startingBranch: string;
		};
	};
	automationMode: "AUTOMATION_MODE_UNSPECIFIED" | "AUTOMATION_MODE_GENERATION";
}

export interface JulesSessionResponse {
	name: string;
	title: string;
	createTime: string;
	updateTime: string;
}

export interface JulesDependencies {
	fetch: typeof fetch;
}

const defaultDependencies: JulesDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
};

/**
 * Creates an autonomous session in the Jules API for dependency analysis.
 * Strictly uses native fetch and follows the v1alpha REST specification.
 */
export const createJulesSession = async (
	apiKey: string,
	repoOwner: string,
	repoName: string,
	dependencyName: string,
	payload: GeminiPromptPayload,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const url = "https://jules.googleapis.com/v1alpha/sessions";

	const body: JulesSessionRequest = {
		title: `depSync: Update ${dependencyName}`,
		// We use the same flattened, token-efficient payload structured for LLMs
		prompt: `Analyze this AST context for breaking changes and provide code fixes. \n\n ${buildGeminiPayload(dependencyName, payload.usages)}`,
		sourceContext: {
			source: `sources/github-${repoOwner}-${repoName}`,
			githubRepoContext: {
				startingBranch: "main",
			},
		},
		automationMode: "AUTOMATION_MODE_UNSPECIFIED",
	};

	const response = await deps.fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		body: JSON.stringify(body),
	});

	if (response.status === 429) {
		throw new Error(
			"Jules API rate limit exceeded (429). Please retry in one hour.",
		);
	}

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(
			`Jules API request failed with status ${response.status}: ${errorBody}`,
		);
	}

	return (await response.json()) as JulesSessionResponse;
};

/**
 * Sends a message to an existing Jules session, typically to trigger
 * AUTOMATION_MODE_GENERATION (e.g., when the user types /fix).
 */
export const sendJulesMessage = async (
	apiKey: string,
	sessionName: string,
	message: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	// The Jules API expects the session name to be part of the URL path along with the custom action :sendMessage
	const url = `https://jules.googleapis.com/v1alpha/${sessionName}:sendMessage`;

	const response = await deps.fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
		// The API expects { "message": string } or similar based on standard Chat patterns.
		body: JSON.stringify({ message }),
	});

	if (response.status === 429) {
		throw new Error(
			"Jules API rate limit exceeded (429). Please retry in one hour.",
		);
	}

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(
			`Jules sendMessage failed with status ${response.status}: ${errorBody}`,
		);
	}
};
