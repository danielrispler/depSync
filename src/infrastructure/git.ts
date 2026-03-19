import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const runCommand = (command: string, args: string[]): string => {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf-8",
		shell: false,
	});

	if (result.error) {
		throw result.error;
	}

	if (result.status !== 0) {
		const message =
			result.stderr?.trim() ||
			`${command} command failed: ${command} ${args.join(" ")}`;
		throw new Error(message);
	}

	return result.stdout || "";
};

const getPreferredPackageManager = (): "pnpm" | "npm" => {
	if (existsSync("pnpm-lock.yaml")) {
		return "pnpm";
	}

	if (!existsSync("package.json")) {
		return "npm";
	}

	try {
		const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
			packageManager?: string;
		};
		return packageJson.packageManager?.startsWith("pnpm@") ? "pnpm" : "npm";
	} catch {
		return "npm";
	}
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
		core.info(`🩹 Applying patch ${patchLabel} with GNU patch...`);
		try {
			runCommand("patch", [
				"-p1",
				"--no-backup-if-mismatch",
				"--fuzz=3",
				"-i",
				patchFilePath,
			]);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new GitPatchApplyError(
				patchLabel,
				`Failed to apply patch ${patchLabel}: ${message}`,
			);
		}
	},

	regenerateLockfile: (): void => {
		const packageManager = getPreferredPackageManager();
		const args =
			packageManager === "pnpm"
				? ["install", "--no-frozen-lockfile"]
				: ["install"];

		core.info(
			`📦 Regenerating lockfile with ${packageManager} ${args.join(" ")}...`,
		);
		runCommand(packageManager, args);
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
