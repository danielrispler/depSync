import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/__tests__/**/*.test.unit.ts", "src/**/__tests__/**/*.test.int.ts"],
		isolate: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["dist/**", "node_modules/**", "eslint.config.js"],
		},
	},
});
