import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "../notifier.js";

describe("sendNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockWebhookUrl = "https://example.com/webhook";
	const payload = {
		repository: "owner/repo",
		generatedAt: "2026-03-19T12:00:00.000Z",
		issues: [
			{
				packageName: "react",
				riskLevel: "high" as const,
				issueUrl: "https://github.com/owner/repo/issues/1",
				summary: "react affects 2 packages.",
			},
		],
	};

	it("should return silently if webhookUrl is missing", async () => {
		const mockFetch = vi.fn();
		const mockWarning = vi.fn();

		await sendNotification(undefined, undefined, payload, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockWarning).not.toHaveBeenCalled();
	});

	it("should return silently if the digest is empty", async () => {
		const mockFetch = vi.fn();

		await sendNotification(
			mockWebhookUrl,
			undefined,
			{ ...payload, issues: [] },
			{ fetch: mockFetch as any, warning: vi.fn() as any },
		);

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("should send a POST request with a signed JSON payload", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true });
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, "secret", payload, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockFetch).toHaveBeenCalledWith(
			mockWebhookUrl,
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify(payload),
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"x-depsync-signature": expect.any(String),
				}),
			}),
		);
		expect(mockWarning).not.toHaveBeenCalled();
	});

	it("should emit a warning if the webhook responds with a non-2xx status code", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, undefined, payload, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockWarning).toHaveBeenCalledWith(
			"Notification webhook failed with status: 403",
		);
	});

	it("should safely catch and warn on network failures without crashing execution", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("Timeout"));
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, undefined, payload, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockWarning).toHaveBeenCalledWith(
			"Failed to send notification webhook: Timeout",
		);
	});
});
