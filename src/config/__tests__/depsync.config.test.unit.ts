import { describe, expect, it, vi } from "vitest";
import { loadDepSyncConfig } from "../depsync.config.js";

describe("loadDepSyncConfig", () => {
	it("prefers the action input over repo config", async () => {
		const config = await loadDepSyncConfig("/workspace", "react,express", {
			readFile: vi
				.fn()
				.mockResolvedValue(JSON.stringify({ coreFrameworks: ["vue"] })) as any,
		});

		expect(config.coreFrameworks).toEqual(["react", "express"]);
	});

	it("uses repo config when the action input is empty", async () => {
		const config = await loadDepSyncConfig("/workspace", "", {
			readFile: vi
				.fn()
				.mockResolvedValue(
					JSON.stringify({ coreFrameworks: ["@angular/core", "rxjs"] }),
				) as any,
		});

		expect(config.coreFrameworks).toEqual(["@angular/core", "rxjs"]);
	});

	it("falls back to built-in defaults when no config exists", async () => {
		const readFile = vi
			.fn()
			.mockRejectedValue(
				Object.assign(new Error("missing"), { code: "ENOENT" }),
			);

		const config = await loadDepSyncConfig("/workspace", undefined, {
			readFile: readFile as any,
		});

		expect(config.coreFrameworks.length).toBeGreaterThan(0);
		expect(config.coreFrameworks).toContain("typescript");
	});
});
