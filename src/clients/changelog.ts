import * as github from "@actions/github";

const MAX_RELEASE_NOTES_CHARS = 3000;

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ChangelogDependencies {
	fetch: typeof fetch;
	getOctokit: (token: string) => ReturnType<typeof github.getOctokit>;
}

const defaultDependencies: ChangelogDependencies = {
	fetch: globalThis.fetch.bind(globalThis),
	getOctokit: github.getOctokit,
};

// ------------------------------------------------------------------
// Internal Helpers
// ------------------------------------------------------------------

/**
 * Resolves the GitHub owner/repo from the npm registry metadata.
 * The `repository` field can be either `{ type, url }` or a plain string.
 *
 * Common URL formats:
 *   - "https://github.com/owner/repo.git"
 *   - "git+https://github.com/owner/repo.git"
 *   - "git://github.com/owner/repo.git"
 *   - "github:owner/repo"
 */
export const resolveGitHubRepo = async (
	packageName: string,
	deps: ChangelogDependencies = defaultDependencies,
): Promise<{ owner: string; repo: string } | null> => {
	const url = `https://registry.npmjs.org/${packageName}`;
	const response = await deps.fetch(url, {
		headers: { Accept: "application/json" },
	});

	if (!response.ok) return null;

	const data = (await response.json()) as {
		repository?: { type?: string; url?: string } | string;
	};

	const repoField = data.repository;
	if (!repoField) return null;

	const rawUrl =
		typeof repoField === "string" ? repoField : (repoField.url ?? "");

	// Match "github.com/owner/repo" from any URL variant
	const match = rawUrl.match(/github\.com[/:]([^/]+)\/([^/.#]+)/);
	if (!match?.[1] || !match[2]) return null;

	return { owner: match[1], repo: match[2] };
};

/**
 * Fetches the release body for a specific version tag.
 * Tries `v${version}` first (most common convention), then `${version}`.
 */
export const fetchReleaseNotes = async (
	token: string,
	owner: string,
	repo: string,
	version: string,
	deps: ChangelogDependencies = defaultDependencies,
): Promise<string | null> => {
	const octokit = deps.getOctokit(token);
	const tags = [`v${version}`, version];

	for (const tag of tags) {
		try {
			const { data } = await octokit.rest.repos.getReleaseByTag({
				owner,
				repo,
				tag,
			});
			if (data.body) return data.body;
		} catch {
			// Tag not found — try next convention
		}
	}

	return null;
};

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Orchestrator-facing function that resolves release notes for a dependency.
 * Entirely fail-safe: any error anywhere returns null.
 * Truncates output to MAX_RELEASE_NOTES_CHARS to protect LLM token budgets.
 */
export const getReleaseNotesForDependency = async (
	token: string,
	packageName: string,
	version: string,
	deps: ChangelogDependencies = defaultDependencies,
): Promise<string | null> => {
	try {
		const repoInfo = await resolveGitHubRepo(packageName, deps);
		if (!repoInfo) return null;

		const notes = await fetchReleaseNotes(
			token,
			repoInfo.owner,
			repoInfo.repo,
			version,
			deps,
		);

		if (!notes) return null;

		if (notes.length > MAX_RELEASE_NOTES_CHARS) {
			return `${notes.slice(0, MAX_RELEASE_NOTES_CHARS)}\n\n...[RELEASE NOTES TRUNCATED BY DEPSYNC]`;
		}

		return notes;
	} catch {
		// Entire pipeline is fail-safe — never crash the Action for release notes
		return null;
	}
};
