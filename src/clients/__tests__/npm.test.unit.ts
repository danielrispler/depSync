import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestVersion, isUpdateNeeded } from "../npm.js";

describe("getLatestVersion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return the latest version from the npm registry dist-tags", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				name: "vitest",
				"dist-tags": { latest: "4.0.18" },
			}),
		});

		const result = await getLatestVersion("vitest", {
			fetch: mockFetch as typeof fetch,
		});

		expect(result).toBe("4.0.18");
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("should use the minimal vnd.npm.install-v1+json accept header to reduce payload size", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				name: "vitest",
				"dist-tags": { latest: "4.0.18" },
			}),
		});

		await getLatestVersion("vitest", { fetch: mockFetch as typeof fetch });

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("vitest"),
			expect.objectContaining({
				headers: { Accept: "application/vnd.npm.install-v1+json" },
			}),
		);
	});

	it("should throw a generic error without leaking the package name or URL when the registry responds with a non-ok status", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
		});

		await expect(
			getLatestVersion("some-private-package", {
				fetch: mockFetch as typeof fetch,
			}),
		).rejects.toThrow("Failed to fetch registry data for package");
	});

	it("should propagate network-level errors (e.g. DNS failure) without swallowing them", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

		await expect(
			getLatestVersion("vitest", { fetch: mockFetch as typeof fetch }),
		).rejects.toThrow("fetch failed");
	});
});

describe("isUpdateNeeded", () => {
	it("should return false when the current version equals the latest version exactly", () => {
		expect(isUpdateNeeded("4.0.18", "4.0.18")).toBe(false);
	});

	it("should return true when the current version is behind the latest version", () => {
		expect(isUpdateNeeded("4.0.0", "4.0.18")).toBe(true);
	});

	it("should strip a caret (^) prefix before comparing", () => {
		expect(isUpdateNeeded("^4.0.18", "4.0.18")).toBe(false);
		expect(isUpdateNeeded("^4.0.0", "4.0.18")).toBe(true);
	});

	it("should strip a tilde (~) prefix before comparing", () => {
		expect(isUpdateNeeded("~4.0.18", "4.0.18")).toBe(false);
		expect(isUpdateNeeded("~4.0.0", "4.0.18")).toBe(true);
	});
});
