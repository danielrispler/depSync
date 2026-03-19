import {
	buildAnalysisPayload,
	buildFixPayload,
} from "../core/orchestrator/payload.js";
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

export interface JulesFix {
	filePath: string;
	fileContent: string;
}

export interface JulesSessionSummary {
	activityCount: number;
	signals: string[];
}

export interface JulesDependencies {
	fetch: typeof fetch;
}

const defaultDependencies: JulesDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
};

const BASE_URL = "https://jules.googleapis.com/v1alpha";

const getHeaders = (apiKey: string): Record<string, string> => ({
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

const createSession = async (
	apiKey: string,
	request: JulesSessionRequest,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const response = await deps.fetch(`${BASE_URL}/sessions`, {
		method: "POST",
		headers: getHeaders(apiKey),
		body: JSON.stringify(request),
	});

	return handleResponse<JulesSessionResponse>(response);
};

/**
 * Lists available sources for the Jules API.
 */
export const listJulesSources = async (
	apiKey: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSourcesResponse> => {
	const response = await deps.fetch(`${BASE_URL}/sources`, {
		headers: getHeaders(apiKey),
	});
	return handleResponse<JulesSourcesResponse>(response);
};

export const createJulesAnalysisSession = async (
	apiKey: string,
	repoOwner: string,
	repoName: string,
	drift: AggregatedDrift,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> =>
	createSession(
		apiKey,
		{
			title: `depSync: Analyze ${drift.dependencyName}`,
			prompt: buildAnalysisPayload(
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
		},
		deps,
	);

export const createJulesSession: typeof createJulesAnalysisSession =
	createJulesAnalysisSession;

export const createJulesFixSession = async (
	apiKey: string,
	repoOwner: string,
	repoName: string,
	drift: AggregatedDrift,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> =>
	createSession(
		apiKey,
		{
			title: `depSync: Fix ${drift.dependencyName}`,
			prompt: buildFixPayload(
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
		},
		deps,
	);

/**
 * Gets the details of an existing Jules session.
 */
export const getJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const response = await deps.fetch(`${BASE_URL}/${sessionName}`, {
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
	const response = await deps.fetch(`${BASE_URL}/${sessionName}:approvePlan`, {
		method: "POST",
		headers: getHeaders(apiKey),
	});
	await handleResponse<void>(response);
};

/**
 * Sends a message to an existing Jules session and collects file artifacts.
 */
export const sendJulesMessage = async (
	apiKey: string,
	sessionName: string,
	prompt: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesFix[]> => {
	const response = await deps.fetch(`${BASE_URL}/${sessionName}:sendMessage`, {
		method: "POST",
		headers: getHeaders(apiKey),
		body: JSON.stringify({ prompt }),
	});

	await handleResponse<void>(response);

	const activities = await listJulesActivities(apiKey, sessionName, 20, deps);
	const fixes: JulesFix[] = [];

	for (const activity of activities.activities) {
		if (!activity.artifacts) continue;

		for (const artifact of activity.artifacts) {
			if (artifact.path && artifact.contents) {
				fixes.push({
					filePath: artifact.path as string,
					fileContent: artifact.contents as string,
				});
			}
		}
	}

	return fixes;
};

/**
 * Lists activities in a Jules session.
 */
export const listJulesActivities = async (
	apiKey: string,
	sessionName: string,
	pageSize: number = 30,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesActivitiesResponse> => {
	const response = await deps.fetch(
		`${BASE_URL}/${sessionName}/activities?pageSize=${pageSize}`,
		{
			headers: getHeaders(apiKey),
		},
	);
	return handleResponse<JulesActivitiesResponse>(response);
};

export const summarizeJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionSummary> => {
	const activities = await listJulesActivities(apiKey, sessionName, 20, deps);
	const signals = new Set<string>();

	for (const activity of activities.activities) {
		if (activity.progressUpdated?.title) {
			signals.add(activity.progressUpdated.title.trim());
		}
		if (activity.progressUpdated?.description) {
			signals.add(activity.progressUpdated.description.trim());
		}
		if (activity.planGenerated?.plan.steps) {
			for (const step of activity.planGenerated.plan.steps) {
				signals.add(step.title.trim());
			}
		}
	}

	return {
		activityCount: activities.activities.length,
		signals: Array.from(signals)
			.filter((entry) => entry.length > 0)
			.slice(0, 5),
	};
};

/**
 * Terminates a Jules session to free cloud resources.
 */
export const deleteJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<void> => {
	const response = await deps.fetch(`${BASE_URL}/${sessionName}`, {
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
