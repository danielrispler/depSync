import type { AggregatedDrift } from "../core/orchestrator/orchestrator.utils.js";
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

export interface JulesFileFix {
	filePath: string;
	fileContent: string;
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
 * Accepts a full AggregatedDrift to provide Jules with release notes,
 * service descriptions, and AST context in a single structured prompt.
 */
export const createJulesSession = async (
	apiKey: string,
	repoOwner: string,
	repoName: string,
	drift: AggregatedDrift,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const url = "https://jules.googleapis.com/v1alpha/sessions";

	const body: JulesSessionRequest = {
		title: `depSync: Update ${drift.dependencyName}`,
		prompt: buildGeminiPayload(
			drift.dependencyName,
			drift.payloads,
			drift.releaseNotes,
		),
		sourceContext: {
			source: `sources/github/${repoOwner}/${repoName}`,
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
		const status = response.status;

		if (status === 404) {
			throw new Error(
				`Jules API returned 404: Requested entity not found. 
Please ensure the Jules GitHub App is installed on ${repoOwner}/${repoName} at https://jules.google/.
API Response: ${errorBody}`,
			);
		}

		throw new Error(
			`Jules API request failed with status ${status}: ${errorBody}`,
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
): Promise<JulesFileFix[]> => {
	// The Jules API expects the session name to be part of the URL path along with the custom action :sendMessage
	const url = `https://jules.googleapis.com/v1alpha/${sessionName}:sendMessage`;

	const response = await deps.fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": apiKey,
		},
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

	const data = await response.json();
	// Assume the API returns { fixes: JulesFileFix[] } or the array directly.
	// Based on the instruction: "Assume the API returns a JSON array of { filePath: string, fileContent: string }"
	return (data.fixes || data) as JulesFileFix[];
};

/**
 * Terminates a Jules session to free cloud resources.
 */
export const deleteJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	const url = `https://jules.googleapis.com/v1alpha/${sessionName}`;

	const response = await deps.fetch(url, {
		method: "DELETE",
		headers: {
			"x-goog-api-key": apiKey,
		},
	});

	if (response.status === 404) {
		// Already deleted or never existed, return gracefully
		return;
	}

	if (response.status === 429) {
		throw new Error(
			"Jules API rate limit exceeded (429). Please retry in one hour.",
		);
	}

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(
			`Jules deleteSession failed with status ${response.status}: ${errorBody}`,
		);
	}
};
