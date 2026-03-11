import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanWorkspace } from "../scanner.js";

describe("scanWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should explicitly exclude ignored directories in the glob pattern", async () => {
		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue([]),
		});

		await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile: vi.fn(),
			warning: vi.fn(),
		});

		expect(createGlobber).toHaveBeenCalledWith(
			"/test/workspace/**/package.json\n" +
				"!/test/workspace/**/node_modules/**\n" +
				"!/test/workspace/**/dist/**\n" +
				"!/test/workspace/**/build/**\n" +
				"!/test/workspace/**/.git/**",
		);
	});

	it("should parse valid package.json files and return a map", async () => {
		const mockFiles = [
			"/test/workspace/package.json",
			"/test/workspace/packages/a/package.json",
		];

		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue(mockFiles),
		});

		const readFile = vi.fn().mockImplementation(async (path: string) => {
			if (path === "/test/workspace/package.json") {
				return JSON.stringify({ name: "root" });
			}
			return JSON.stringify({ name: "package-a" });
		});

		const warning = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
		});

		expect(result.size).toBe(2);
		expect(result.get("/test/workspace/package.json")).toEqual({
			name: "root",
		});
		expect(result.get("/test/workspace/packages/a/package.json")).toEqual({
			name: "package-a",
		});
		expect(warning).not.toHaveBeenCalled();
	});

	it("should safely log a generic warning and ignore unparseable package.json files without leaking data", async () => {
		const mockFiles = [
			"/test/workspace/package.json",
			"/test/workspace/invalid/package.json",
		];

		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue(mockFiles),
		});

		const readFile = vi.fn().mockImplementation(async (path: string) => {
			if (path === "/test/workspace/invalid/package.json") {
				throw new Error(
					"Access denied or random fs error containing sensitive server path",
				);
			}
			return JSON.stringify({ name: "root" });
		});

		const warning = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
		});

		expect(result.size).toBe(1);
		expect(result.get("/test/workspace/package.json")).toEqual({
			name: "root",
		});

		// Zero-leakage verification
		expect(warning).toHaveBeenCalledWith(
			"Failed to parse a package.json file. Skipping.",
		);
		expect(warning).toHaveBeenCalledTimes(1);
	});
});
