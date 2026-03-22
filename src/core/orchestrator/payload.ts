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

const FIX_INSTRUCTION_TEXT = `ROLE: You are an autonomous AI developer maintaining a critical production system.
MANDATE: You MUST autonomously migrate dependencies, modify TypeScript source code to fix breaking changes, and verify your work by running native tests (\`pnpm install\`, \`pnpm typecheck\`, \`pnpm test\`).
CRITICAL ZERO-TOUCH RULE: You are running in a headless overnight CI pipeline. You CANNOT ask questions. You CANNOT wait for user input or approvals. If you encounter ambiguity, make your best engineering judgment, complete the task, and natively export the Pull Request. Never pause the session.

MONOREPO EXECUTION STRATEGY:
You are operating in a TypeScript monorepo where packages depend on each other's compiled \`dist\` outputs. You must intelligently decide your build and test scope based on the nature of your code changes:

1. PUBLIC API CHANGES (High Impact): If your modifications in a package alter exported function signatures, return types, or exported interfaces, you MUST first build that specific package (e.g., \`pnpm build --filter <package_name>\`) to update its \`dist\` directory. After the build succeeds, you MUST run tests and typechecks across the ENTIRE monorepo (\`pnpm test\`, \`pnpm typecheck\`) to ensure downstream consumers are not broken.

2. INTERNAL LOGIC CHANGES (Low Impact): If your modifications only affect internal implementation details and DO NOT alter any public/exported signatures, types, or return values, you should optimize execution time. DO NOT build or test the entire monorepo. Instead, strictly run tests and typechecks ONLY for the specific package you modified (e.g., \`pnpm test --filter <package_name>\`, \`pnpm typecheck --filter <package_name>\`).`;

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
