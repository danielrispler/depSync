import type { GeminiPromptPayload } from "../../types/drift.js";

export interface JulesPromptPayload {
	instruction: string;
	dependencyName: string;
	releaseNotes: string | null;
	usages: ProcessedUsage[];
}

export type GeminiFinalPrompt = JulesPromptPayload;

export interface ProcessedUsage {
	serviceName: string;
	serviceDescription: string;
	file: string;
	importStatement: string;
	callingStatement: string;
	line: number;
	enclosingFunction: ProcessedEnclosingFunction | null;
}

export interface ProcessedEnclosingFunction {
	name: string;
	signature: string;
	body: string;
	isExported: boolean;
	localCallers: ProcessedCaller[];
}

export interface ProcessedCaller {
	statement: string;
	line: number;
}

const ANALYSIS_INSTRUCTION_TEXT = `You are an expert dependency migration analyst. Review the release notes and AST footprint, then produce a concise impact analysis in markdown.

Required sections:
1. Summary
2. Risk
3. Recommended migration focus

Rules:
- Keep the response under 220 words.
- Call out whether the dependency is isolated or structurally widespread.
- Mention the highest-risk files or services only by path/name, never dump full code.
- Do not propose a pull request or branch strategy.`;

const FIX_INSTRUCTION_TEXT = `You are an expert migration assistant. The target dependency has breaking changes outlined in the release notes and the AST context shows exactly where it is used.

Rules:
1. **HEADLESS AUTONOMOUS MODE:** "You are running in a headless, zero-touch CI environment. You CANNOT ask questions or wait for user input. If you encounter ambiguity regarding breaking changes, you MUST make your best executive decision, write the code patch, and immediately finish the session."
2. **ABSOLUTE BAN ON CI EXECUTION:** "CRITICAL: You are STRICTLY FORBIDDEN from running ANY shell commands. Do NOT run \`npm install\`, \`pnpm install\`, \`pnpm test\`, \`typecheck\`, \`build\`, \`lint\`, or any validation scripts. We handle CI natively on our end after you provide the patch."
3. **CODE MIGRATION MANDATE:** "Your primary job is CODE MIGRATION, not just version bumping. If a dependency has a major update, you MUST analyze the provided AST context and modify the actual TypeScript source code files to adapt to the new API/breaking changes. Do not just update \`package.json\` and stop. Provide the unidiff patches for ALL required source code changes."
4. Generate the exact code changes needed to safely migrate the codebase.
5. Prioritize correctness over breadth; only touch files that require changes.
6. If an exported function signature would need to change, treat that as high risk and explain it clearly.
7. Return actionable implementation output suitable for downstream file patch application.
8. CRITICAL: DO NOT modify \`pnpm-lock.yaml\` or any lockfiles. You must only modify \`package.json\` and the relevant source files.`;

const toProcessedUsages = (
	payloads: ReadonlyArray<GeminiPromptPayload>,
): ProcessedUsage[] =>
	payloads.flatMap((payload) =>
		payload.usages.flatMap((usage) =>
			usage.usages.map((ctx) => ({
				serviceName: payload.package.packageName,
				serviceDescription: payload.package.serviceDescription,
				file: usage.file,
				importStatement: usage.importStatement,
				callingStatement: ctx.statement,
				line: ctx.line,
				enclosingFunction: ctx.enclosingFunction
					? {
							name: ctx.enclosingFunction.name,
							signature: ctx.enclosingFunction.signature,
							body: ctx.enclosingFunction.body,
							isExported: ctx.enclosingFunction.isExported,
							localCallers: ctx.localCallers.map((caller) => ({
								statement: caller.statement,
								line: caller.line,
							})),
						}
					: null,
			})),
		),
	);

const buildPromptPayload = (
	instruction: string,
	dependencyName: string,
	payloads: ReadonlyArray<GeminiPromptPayload>,
	releaseNotes: string | null,
): string =>
	JSON.stringify({
		instruction,
		dependencyName,
		releaseNotes,
		usages: toProcessedUsages(payloads),
	} satisfies JulesPromptPayload);

export const buildAnalysisPayload = (
	dependencyName: string,
	payloads: ReadonlyArray<GeminiPromptPayload>,
	releaseNotes: string | null,
): string =>
	buildPromptPayload(
		ANALYSIS_INSTRUCTION_TEXT,
		dependencyName,
		payloads,
		releaseNotes,
	);

export const buildFixPayload = (
	dependencyName: string,
	payloads: ReadonlyArray<GeminiPromptPayload>,
	releaseNotes: string | null,
): string =>
	buildPromptPayload(
		FIX_INSTRUCTION_TEXT,
		dependencyName,
		payloads,
		releaseNotes,
	);

export const buildGeminiPayload: typeof buildFixPayload = buildFixPayload;
