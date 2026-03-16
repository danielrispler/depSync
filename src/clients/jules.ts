import { buildGeminiPayload } from "../core/orchestrator/payload.js";
import type { AggregatedDrift } from "../types/drift.js";

export interface JulesSessionRequest {
	title: string;
	prompt: string;
	sourceContext: {
		source: string;
		githubRepoContext: {
			startingBranch: string;
		};
	};
	automationMode: "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR";
	requirePlanApproval?: boolean;
}

export interface JulesSessionResponse {
	name: string;
	id: string;
	title: string;
	sourceContext: {
		source: string;
		githubRepoContext: {
			startingBranch: string;
		};
	};
	prompt: string;
	outputs?: Array<{
		pullRequest?: {
			url: string;
			title: string;
			description: string;
		};
	}>;
}

export interface JulesSource {
	name: string;
	id: string;
	githubRepo: {
		owner: string;
		repo: string;
	};
}

export interface JulesSourcesResponse {
	sources: JulesSource[];
	nextPageToken?: string;
}

export interface JulesActivity {
	name: string;
	id: string;
	createTime: string;
	originator: "agent" | "user";
	planGenerated?: {
		plan: {
			id: string;
			steps: Array<{
				id: string;
				title: string;
				index?: number;
			}>;
		};
	};
	planApproved?: {
		planId: string;
	};
	progressUpdated?: {
		title: string;
		description?: string;
	};
	sessionCompleted?: Record<string, unknown>;
	artifacts?: Array<Record<string, unknown>>;
}

export interface JulesActivitiesResponse {
	activities: JulesActivity[];
	nextPageToken?: string;
}

export interface JulesDependencies {
	fetch: typeof fetch;
}

const defaultDependencies: JulesDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
};

const BASE_URL = "https://jules.googleapis.com/v1alpha";

const getHeaders = (apiKey: string) => ({
	"Content-Type": "application/json",
	"X-Goog-Api-Key": apiKey,
});

const handleResponse = async <T>(response: Response): Promise<T> => {
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

	if (response.status === 204) {
		return {} as T;
	}

	const text = await response.text();
	return (text ? JSON.parse(text) : {}) as T;
};

/**
 * Lists available sources for the Jules API.
 */
export const listJulesSources = async (
	apiKey: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSourcesResponse> => {
	const url = `${BASE_URL}/sources`;
	const response = await deps.fetch(url, {
		headers: getHeaders(apiKey),
	});
	return handleResponse<JulesSourcesResponse>(response);
};

/**
 * Creates an autonomous session in the Jules API for dependency analysis.
 */
export const createJulesSession = async (
	apiKey: string,
	repoOwner: string,
	repoName: string,
	drift: AggregatedDrift,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const url = `${BASE_URL}/sessions`;

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
		automationMode: "AUTO_CREATE_PR",
	};

	const response = await deps.fetch(url, {
		method: "POST",
		headers: getHeaders(apiKey),
		body: JSON.stringify(body),
	});

	return handleResponse<JulesSessionResponse>(response);
};

/**
 * Gets the details of an existing Jules session.
 */
export const getJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const url = `${BASE_URL}/${sessionName}`;
	const response = await deps.fetch(url, {
		headers: getHeaders(apiKey),
	});
	return handleResponse<JulesSessionResponse>(response);
};

/**
 * Approves the latest plan in a Jules session.
 */
export const approveJulesPlan = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	const url = `${BASE_URL}/${sessionName}:approvePlan`;
	const response = await deps.fetch(url, {
		method: "POST",
		headers: getHeaders(apiKey),
	});
	await handleResponse<void>(response);
};

/**
 * Sends a message to an existing Jules session.
 */
export const sendJulesMessage = async (
	apiKey: string,
	sessionName: string,
	prompt: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	const url = `${BASE_URL}/${sessionName}:sendMessage`;

	const response = await deps.fetch(url, {
		method: "POST",
		headers: getHeaders(apiKey),
		body: JSON.stringify({ prompt }),
	});

	await handleResponse<void>(response);
};

/**
 * Lists activities in a Jules session.
 */
export const listJulesActivities = async (
	apiKey: string,
	sessionName: string,
	pageSize = 30,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesActivitiesResponse> => {
	const url = `${BASE_URL}/${sessionName}/activities?pageSize=${pageSize}`;
	const response = await deps.fetch(url, {
		headers: getHeaders(apiKey),
	});
	return handleResponse<JulesActivitiesResponse>(response);
};

/**
 * Terminates a Jules session to free cloud resources.
 */
export const deleteJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	const url = `${BASE_URL}/${sessionName}`;

	const response = await deps.fetch(url, {
		method: "DELETE",
		headers: {
			"X-Goog-Api-Key": apiKey,
		},
	});

	if (response.status === 404) {
		return;
	}

	await handleResponse<void>(response);
};
