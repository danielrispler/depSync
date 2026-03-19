import { spawnSync } from "node:child_process";
import * as core from "@actions/core";

export class GitPatchApplyError extends Error {
	readonly patchLabel: string;

	constructor(patchLabel: string, message: string) {
		super(message);
		this.name = "GitPatchApplyError";
		this.patchLabel = patchLabel;
	}
}

/**
 * Execute a git command using spawnSync with array-based arguments for maximum security.
 * Throws an error with stderr output if the command fails.
 */
const runGit = (
	args: string[],
	_options: { capture?: boolean } = {},
): string => {
	const result = spawnSync("git", args, {
		encoding: "utf-8",
		shell: false,
	});

	if (result.status !== 0) {
		const message =
			result.stderr?.trim() || `Git command failed: git ${args.join(" ")}`;
		throw new Error(message);
	}

	return result.stdout || "";
};

/**
 * Clean wrapper for Git operations to decouple from shell execution.
 * Uses spawnSync internally with strict array arguments to prevent command injection.
 */
export const gitOps = {
	configureUser: (
		name: string = "depSync Bot",
		email: string = "bot@depsync.ai",
	): void => {
		core.info(`🔧 Configuring Git user: ${name} <${email}>`);
		runGit(["config", "user.name", name]);
		runGit(["config", "user.email", email]);
	},

	createBranch: (branchName: string): void => {
		core.info(`🌿 Creating branch ${branchName}...`);
		runGit(["checkout", "-b", branchName]);
	},

	commitAll: (message: string): void => {
		core.info("💾 Committing changes...");
		runGit(["add", "."]);
		runGit(["commit", "-m", message]);
	},

	applyPatchFile: (patchFilePath: string, patchLabel: string): void => {
		core.info(`🩹 Applying patch ${patchLabel}...`);
		try {
			runGit(["apply", "--whitespace=fix", patchFilePath]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new GitPatchApplyError(
				patchLabel,
				`Failed to apply patch ${patchLabel}: ${message}`,
			);
		}
	},

	restoreWorkingTree: (): void => {
		core.info("♻️ Restoring clean working tree...");
		runGit(["reset", "--hard"]);
		runGit(["clean", "-fd"]);
	},

	push: (
		remoteUrl: string,
		branchName: string,
		force: boolean = false,
	): void => {
		core.info(`⬆️ Pushing changes to ${branchName}...`);
		const args = ["push", remoteUrl, branchName];
		if (force) {
			args.push("--force");
		}
		runGit(args);
	},
};
