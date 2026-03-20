import * as core from "@actions/core";
import {
	buildAnalysisPayload,
	buildFixPayload,
} from "../core/orchestrator/payload.js";
import type { AggregatedDrift } from "../types/drift.js";

export type JulesSessionState =
	| "QUEUED"
	| "PLANNING"
	| "AWAITING_PLAN_APPROVAL"
	| "AWAITING_USER_FEEDBACK"
	| "IN_PROGRESS"
	| "PAUSED"
	| "COMPLETED"
	| "FAILED";

export interface ResolvedJulesSource {
	sourceName: string;
	defaultBranch: string;
}

export interface JulesSessionRequest {
	title: string;
	prompt: string;
	sourceContext: {
		source: string;
		githubRepoContext: {
			startingBranch: string;
		};
	};
	automationMode?: "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR";
	requirePlanApproval?: boolean;
}

export interface JulesSessionResponse {
	name: string;
	id: string;
	title: string;
	state: JulesSessionState;
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
		isPrivate?: boolean;
		defaultBranch?: {
			displayName: string;
		};
		branches?: Array<{
			displayName: string;
		}>;
	};
}

export interface JulesSourcesResponse {
	sources: JulesSource[];
	nextPageToken?: string;
}

interface JulesPlanStep {
	id: string;
	title: string;
	index?: number;
}

export interface JulesBaseActivity {
	name: string;
	id: string;
	createTime: string;
	originator: "agent" | "user";
	artifacts?: JulesArtifact[];
}

export interface JulesPlanGeneratedActivity extends JulesBaseActivity {
	planGenerated: {
		plan: {
			id: string;
			steps: JulesPlanStep[];
		};
	};
}

export interface JulesPlanApprovedActivity extends JulesBaseActivity {
	planApproved: {
		planId: string;
	};
}

export interface JulesUserMessagedActivity extends JulesBaseActivity {
	userMessaged: {
		userMessage: string;
	};
}

export interface JulesAgentMessagedActivity extends JulesBaseActivity {
	agentMessaged: {
		agentMessage: string;
	};
}

export interface JulesProgressUpdatedActivity extends JulesBaseActivity {
	progressUpdated: {
		title: string;
		description?: string;
	};
}

export interface JulesSessionCompletedActivity extends JulesBaseActivity {
	sessionCompleted: Record<string, never>;
}

export interface JulesSessionFailedActivity extends JulesBaseActivity {
	sessionFailed: {
		reason?: string;
	};
}

export type JulesActivity =
	| JulesPlanGeneratedActivity
	| JulesPlanApprovedActivity
	| JulesUserMessagedActivity
	| JulesAgentMessagedActivity
	| JulesProgressUpdatedActivity
	| JulesSessionCompletedActivity
	| JulesSessionFailedActivity
	| JulesBaseActivity;

export interface JulesActivitiesResponse {
	activities: JulesActivity[];
	nextPageToken?: string;
}

export interface JulesChangeSetArtifact {
	changeSet: {
		source: string;
		gitPatch: {
			baseCommitId: string;
			unidiffPatch: string;
			suggestedCommitMessage?: string;
		};
	};
}

export interface JulesBashOutputArtifact {
	bashOutput: {
		command: string;
		output: string;
		exitCode: number;
	};
}

export type JulesArtifact =
	| JulesChangeSetArtifact
	| JulesBashOutputArtifact
	| Record<string, unknown>;

export interface JulesPatchArtifact {
	activityName: string;
	createTime: string;
	patch: string;
	suggestedCommitMessage?: string;
}

export interface JulesSessionSummary {
	activityCount: number;
	analysisMarkdown: string | null;
}

export interface JulesDependencies {
	fetch: typeof fetch;
}

export class JulesApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "JulesApiError";
		this.status = status;
	}
}

export class JulesSourceNotFoundError extends Error {
	constructor(owner: string, repo: string) {
		super(`Could not resolve Jules source for ${owner}/${repo}.`);
		this.name = "JulesSourceNotFoundError";
	}
}

export class JulesSessionStatusError extends Error {
	readonly sessionName: string;
	readonly state: JulesSessionState | "TIMEOUT";
	readonly failureReason?: string;

	constructor(
		sessionName: string,
		state: JulesSessionState | "TIMEOUT",
		message: string,
		failureReason?: string,
	) {
		super(message);
		this.name = "JulesSessionStatusError";
		this.sessionName = sessionName;
		this.state = state;
		this.failureReason = failureReason;
	}
}

export class JulesMissingPatchArtifactError extends Error {
	constructor(sessionName: string) {
		super(
			`No git patch artifacts were found for Jules session ${sessionName}.`,
		);
		this.name = "JulesMissingPatchArtifactError";
	}
}

const defaultDependencies: JulesDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
};

const BASE_URL = "https://jules.googleapis.com/v1alpha";
const DEFAULT_PAGE_SIZE = 100;
const INITIAL_POLL_DELAY_MS = 5_000;
const MAX_POLL_DELAY_MS = 15_000;
const MAX_POLL_WAIT_MS: number = 90 * 60 * 1_000;
const MAX_SESSION_RETRY_ATTEMPTS = 3;
const SESSION_RETRY_BASE_DELAY_MS = 5_000;
const TRANSIENT_INFRASTRUCTURE_ERROR_PATTERN =
	/\b(502|500|503|504|cloning|clone|network|timeout|timed out|connection|socket|fetch failed|curl 22|econnreset|enotfound|eai_again)\b/i;

const getHeaders = (apiKey: string): Record<string, string> => ({
	"Content-Type": "application/json",
	"X-Goog-Api-Key": apiKey,
});

const handleResponse = async <T>(response: Response): Promise<T> => {
	if (response.status === 429) {
		throw new JulesApiError(
			429,
			"Jules API rate limit exceeded (429). Please retry in one hour.",
		);
	}

	if (!response.ok) {
		const errorBody = await response.text();
		throw new JulesApiError(
			response.status,
			`Jules API request failed with status ${response.status}: ${errorBody}`,
		);
	}

	if (response.status === 204) {
		return {} as T;
	}

	const text = await response.text();
	return (text ? JSON.parse(text) : {}) as T;
};

const sleep = async (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

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

export const listJulesSources = async (
	apiKey: string,
	pageSize: number = DEFAULT_PAGE_SIZE,
	pageToken: string | undefined = undefined,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSourcesResponse> => {
	const params = new URLSearchParams({
		pageSize: String(pageSize),
	});

	if (pageToken) {
		params.set("pageToken", pageToken);
	}

	const response = await deps.fetch(
		`${BASE_URL}/sources?${params.toString()}`,
		{
			headers: getHeaders(apiKey),
		},
	);

	return handleResponse<JulesSourcesResponse>(response);
};

export const resolveJulesSource = async (
	apiKey: string,
	owner: string,
	repo: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<ResolvedJulesSource> => {
	let pageToken: string | undefined;

	do {
		const response = await listJulesSources(
			apiKey,
			DEFAULT_PAGE_SIZE,
			pageToken,
			deps,
		);
		const source = response.sources.find(
			(candidate) =>
				candidate.githubRepo.owner === owner &&
				candidate.githubRepo.repo === repo,
		);

		if (source) {
			return {
				sourceName: source.name,
				defaultBranch: source.githubRepo.defaultBranch?.displayName ?? "main",
			};
		}

		pageToken = response.nextPageToken;
	} while (pageToken);

	throw new JulesSourceNotFoundError(owner, repo);
};

const getSessionFailureReason = (
	activities: ReadonlyArray<JulesActivity>,
): string | undefined => {
	for (let index: number = activities.length - 1; index >= 0; index -= 1) {
		const activity = activities[index];
		if (!activity) continue;

		if ("sessionFailed" in activity && activity.sessionFailed?.reason) {
			return activity.sessionFailed.reason;
		}
	}

	return undefined;
};

const isTransientInfrastructureMessage = (message: string): boolean =>
	TRANSIENT_INFRASTRUCTURE_ERROR_PATTERN.test(message);

const toSafeWarningDetails = (error: unknown): string => {
	if (error instanceof JulesApiError) {
		return `HTTP ${error.status}`;
	}

	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();

	if (/\b502\b/.test(normalized)) return "HTTP 502";
	if (/\b500\b/.test(normalized)) return "HTTP 500";
	if (/\b503\b/.test(normalized)) return "HTTP 503";
	if (/\b504\b/.test(normalized)) return "HTTP 504";
	if (/\b(cloning|clone)\b/.test(normalized)) return "repo cloning failure";
	if (/\b(timeout|timed out)\b/.test(normalized)) return "network timeout";
	if (
		/\b(connection|socket|fetch failed|econnreset|enotfound|eai_again)\b/.test(
			normalized,
		)
	) {
		return "network failure";
	}

	return "infrastructure failure";
};

const isTransientInfrastructureError = (error: unknown): boolean => {
	if (error instanceof JulesSessionStatusError) {
		const candidate = error.failureReason ?? error.message;
		return (
			error.state === "FAILED" && isTransientInfrastructureMessage(candidate)
		);
	}

	if (error instanceof JulesApiError) {
		return (
			error.status >= 500 || isTransientInfrastructureMessage(error.message)
		);
	}

	if (error instanceof Error) {
		return isTransientInfrastructureMessage(error.message);
	}

	return false;
};

const isChangeSetArtifact = (
	artifact: JulesArtifact,
): artifact is JulesChangeSetArtifact =>
	typeof (artifact as JulesChangeSetArtifact | undefined)?.changeSet?.gitPatch
		?.unidiffPatch === "string";

export const createJulesAnalysisSession = async (
	apiKey: string,
	source: ResolvedJulesSource,
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
				source: source.sourceName,
				githubRepoContext: {
					startingBranch: source.defaultBranch,
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
	source: ResolvedJulesSource,
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
				source: source.sourceName,
				githubRepoContext: {
					startingBranch: source.defaultBranch,
				},
			},
			automationMode: "AUTOMATION_MODE_UNSPECIFIED",
		},
		deps,
	);

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

export const listJulesActivities = async (
	apiKey: string,
	sessionName: string,
	pageSize: number = DEFAULT_PAGE_SIZE,
	pageToken: string | undefined = undefined,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesActivitiesResponse> => {
	const params = new URLSearchParams({
		pageSize: String(pageSize),
	});

	if (pageToken) {
		params.set("pageToken", pageToken);
	}

	const response = await deps.fetch(
		`${BASE_URL}/${sessionName}/activities?${params.toString()}`,
		{
			headers: getHeaders(apiKey),
		},
	);
	return handleResponse<JulesActivitiesResponse>(response);
};

export const listAllJulesActivities = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesActivity[]> => {
	let pageToken: string | undefined;
	const activities: JulesActivity[] = [];

	do {
		const response = await listJulesActivities(
			apiKey,
			sessionName,
			DEFAULT_PAGE_SIZE,
			pageToken,
			deps,
		);
		activities.push(...response.activities);
		pageToken = response.nextPageToken;
	} while (pageToken);

	return activities.sort(
		(left, right) =>
			new Date(left.createTime).getTime() -
			new Date(right.createTime).getTime(),
	);
};

export const extractAnalysisMarkdown = (
	activities: ReadonlyArray<JulesActivity>,
): string | null => {
	for (let index = activities.length - 1; index >= 0; index -= 1) {
		const activity = activities[index];
		if (!activity) continue;

		if ("agentMessaged" in activity && activity.agentMessaged?.agentMessage) {
			return activity.agentMessaged.agentMessage;
		}
	}

	return null;
};

export const extractPatchArtifacts = (
	sessionName: string,
	activities: ReadonlyArray<JulesActivity>,
): JulesPatchArtifact[] => {
	const patches = activities.flatMap((activity) =>
		(activity.artifacts ?? []).flatMap((artifact) => {
			if (!isChangeSetArtifact(artifact)) return [];

			const patch = artifact.changeSet.gitPatch.unidiffPatch;

			return [
				{
					activityName: activity.name,
					createTime: activity.createTime,
					patch,
					suggestedCommitMessage:
						artifact.changeSet.gitPatch.suggestedCommitMessage,
				},
			];
		}),
	);

	if (patches.length === 0) {
		throw new JulesMissingPatchArtifactError(sessionName);
	}

	return patches;
};

export const waitForJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	const startedAt = Date.now();
	let delayMs = INITIAL_POLL_DELAY_MS;

	while (Date.now() - startedAt <= MAX_POLL_WAIT_MS) {
		const session = await getJulesSession(apiKey, sessionName, deps);

		if (session.state === "COMPLETED") {
			return session;
		}

		if (session.state === "FAILED") {
			const activities = await listAllJulesActivities(
				apiKey,
				sessionName,
				deps,
			).catch(() => []);
			const reason = getSessionFailureReason(activities);
			throw new JulesSessionStatusError(
				sessionName,
				"FAILED",
				reason
					? `Jules session ${sessionName} failed: ${reason}`
					: `Jules session ${sessionName} failed.`,
				reason,
			);
		}

		await sleep(delayMs);
		delayMs = Math.min(delayMs * 2, MAX_POLL_DELAY_MS);
	}

	throw new JulesSessionStatusError(
		sessionName,
		"TIMEOUT",
		`Timed out waiting for Jules session ${sessionName} to complete.`,
	);
};

const cleanupAttemptSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies,
): Promise<void> => {
	await deleteJulesSession(apiKey, sessionName, deps).catch((error) => {
		core.warning(
			`Failed to clean up broken Jules session ${sessionName}: ${toSafeWarningDetails(error)}`,
		);
	});
};

export const runJulesSessionWithRetry = async (
	apiKey: string,
	createSessionAttempt: (
		deps: JulesDependencies,
	) => Promise<JulesSessionResponse>,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionResponse> => {
	let lastError: unknown;

	for (
		let attempt: number = 1;
		attempt <= MAX_SESSION_RETRY_ATTEMPTS;
		attempt += 1
	) {
		let sessionName: string | undefined;

		try {
			const session = await createSessionAttempt(deps);
			sessionName = session.name;
			return await waitForJulesSession(apiKey, session.name, deps);
		} catch (error) {
			lastError = error;

			if (sessionName) {
				await cleanupAttemptSession(apiKey, sessionName, deps);
			}

			if (
				!isTransientInfrastructureError(error) ||
				attempt === MAX_SESSION_RETRY_ATTEMPTS
			) {
				throw error;
			}

			const backoffMs = SESSION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
			core.warning(
				`Transient Jules infrastructure failure on attempt ${attempt}/${MAX_SESSION_RETRY_ATTEMPTS}: ${toSafeWarningDetails(error)}. Retrying in ${backoffMs}ms...`,
			);
			await sleep(backoffMs);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Jules session retry failed without a captured error.");
};

export const summarizeJulesSession = async (
	apiKey: string,
	sessionName: string,
	deps: JulesDependencies = defaultDependencies,
): Promise<JulesSessionSummary> => {
	const activities = await listAllJulesActivities(apiKey, sessionName, deps);
	return {
		activityCount: activities.length,
		analysisMarkdown: extractAnalysisMarkdown(activities),
	};
};

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
