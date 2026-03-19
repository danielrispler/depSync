import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
	spawnSync: spawnSyncMock,
}));

describe("gitOps", () => {
	beforeEach(() => {
		vi.resetModules();
		spawnSyncMock.mockReset();
		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "",
		});
	});

	it("applies patches using GNU patch for resilience", async () => {
		const { gitOps } = await import("../git.js");

		gitOps.applyPatchFile("/tmp/change.patch", "test patch");

		expect(spawnSyncMock).toHaveBeenCalledWith(
			"patch",
			["-p1", "--no-backup-if-mismatch", "--fuzz=3", "-i", "/tmp/change.patch"],
			expect.objectContaining({
				cwd: process.cwd(),
				encoding: "utf-8",
				shell: false,
			}),
		);
	});

	it("regenerates the lockfile with pnpm using shell-free array arguments", async () => {
		const { gitOps } = await import("../git.js");

		gitOps.regenerateLockfile();

		expect(spawnSyncMock).toHaveBeenCalledWith(
			"pnpm",
			["install", "--no-frozen-lockfile"],
			expect.objectContaining({
				cwd: process.cwd(),
				encoding: "utf-8",
				shell: false,
			}),
		);
	});
});
