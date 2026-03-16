import { execSync } from "node:child_process";
import * as core from "@actions/core";

/**
 * Clean wrapper for Git operations to decouple from shell execution.
 */
export const gitOps = {
	configureUser: (name = "depSync Bot", email = "bot@depsync.ai") => {
		core.info(`🔧 Configuring Git user: ${name} <${email}>`);
		execSync(`git config user.name "${name}"`);
		execSync(`git config user.email "${email}"`);
	},

	createBranch: (branchName: string) => {
		core.info(`🌿 Creating branch ${branchName}...`);
		execSync(`git checkout -b ${branchName}`);
	},

	commitAll: (message: string) => {
		core.info("💾 Committing changes...");
		execSync("git add .");
		execSync(`git commit -m "${message}"`);
	},

	push: (remoteUrl: string, branchName: string, force = false) => {
		core.info(`⬆️ Pushing changes to ${branchName}...`);
		const forceFlag = force ? " --force" : "";
		execSync(`git push "${remoteUrl}" ${branchName}${forceFlag}`);
	},
};
