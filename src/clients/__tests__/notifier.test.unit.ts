import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "../notifier.js";

describe("sendNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const mockWebhookUrl = "https://example.com/webhook";
	const mockMessage = "Test alert!";

	it("should return silently if webhookUrl is completely empty or undefined", async () => {
		const mockFetch = vi.fn();
		const mockWarning = vi.fn();

		await sendNotification("", mockMessage, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockWarning).not.toHaveBeenCalled();
	});

	it("should send a POST request with the exact message in the payload", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true });
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, mockMessage, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockFetch).toHaveBeenCalledWith(
			mockWebhookUrl,
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: mockMessage, content: mockMessage }),
			}),
		);
		expect(mockWarning).not.toHaveBeenCalled();
	});

	it("should emit a warning if the webhook responds with a non-2xx status code", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, mockMessage, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockWarning).toHaveBeenCalledWith(
			"Webhook notification failed with status: 403",
		);
	});

	it("should safely catch and warn on hard network failures without crashing execution", async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error("Timeout"));
		const mockWarning = vi.fn();

		await sendNotification(mockWebhookUrl, mockMessage, {
			fetch: mockFetch as any,
			warning: mockWarning as any,
		});

		expect(mockWarning).toHaveBeenCalledWith(
			"Failed to send webhook notification: Timeout",
		);
	});
});
