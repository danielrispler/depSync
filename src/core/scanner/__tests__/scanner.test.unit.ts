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
			debug: vi.fn(),
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
		const debug = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
			debug,
		});

		expect(result.size).toBe(2);
		expect(result.get("/test/workspace/package.json")).toEqual({
			name: "root",
		});
		expect(result.get("/test/workspace/packages/a/package.json")).toEqual({
			name: "package-a",
		});
		expect(warning).not.toHaveBeenCalled();
		expect(debug).not.toHaveBeenCalled();
	});

	it("should emit a debug message with the error text and a warning with only the filename (not the path) when a file is unreadable", async () => {
		const mockFiles = [
			"/test/workspace/package.json",
			"/test/workspace/packages/secret-service/package.json",
		];

		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue(mockFiles),
		});

		const readFile = vi.fn().mockImplementation(async (path: string) => {
			if (path === "/test/workspace/packages/secret-service/package.json") {
				throw new Error(
					"EACCES: permission denied, open '/secret-service/package.json'",
				);
			}
			return JSON.stringify({ name: "root" });
		});

		const warning = vi.fn();
		const debug = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
			debug,
		});

		expect(result.size).toBe(1);

		// Zero-leakage: warning must contain only the basename, not the full path
		expect(warning).toHaveBeenCalledWith(
			"Failed to parse package.json. Skipping.",
		);
		expect(warning).toHaveBeenCalledTimes(1);

		// Debuggability: the raw error message must be emitted under debug (gated to admins)
		expect(debug).toHaveBeenCalledWith(
			"EACCES: permission denied, open '/secret-service/package.json'",
		);
		expect(debug).toHaveBeenCalledTimes(1);
	});

	it("should reject and skip a file whose content is a valid JSON primitive (not an object)", async () => {
		const mockFiles = ["/test/workspace/package.json"];

		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue(mockFiles),
		});

		// JSON.parse('"hello"') succeeds — this is the silent failure we guard against
		const readFile = vi.fn().mockResolvedValue(JSON.stringify("hello"));

		const warning = vi.fn();
		const debug = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
			debug,
		});

		expect(result.size).toBe(0);
		expect(debug).toHaveBeenCalledWith("File content is not a JSON object.");
		expect(warning).toHaveBeenCalledWith(
			"Failed to parse package.json. Skipping.",
		);
	});

	it("should reject and skip a file whose content is a JSON array (not an object)", async () => {
		const mockFiles = ["/test/workspace/package.json"];

		const createGlobber = vi.fn().mockResolvedValue({
			glob: vi.fn().mockResolvedValue(mockFiles),
		});

		const readFile = vi
			.fn()
			.mockResolvedValue(JSON.stringify(["dep-a", "dep-b"]));

		const warning = vi.fn();
		const debug = vi.fn();

		const result = await scanWorkspace("/test/workspace", {
			createGlobber,
			readFile,
			warning,
			debug,
		});

		expect(result.size).toBe(0);
		expect(debug).toHaveBeenCalledWith("File content is not a JSON object.");
	});
});
