import type { DependencyUsage } from "../ast/ast.js";

/**
 * Represents the structured system instructions and context
 * provided to the Gemini model for analysis.
 */
export interface GeminiPromptPayload {
	instruction: string;
	dependencyName: string;
	usages: ProcessedUsage[];
}

/**
 * A flatter, text-optimized version of the UsageContext
 * designed for maximum LLM comprehension and minimal token use.
 */
export interface ProcessedUsage {
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

const INSTRUCTION_TEXT = `You are an expert TypeScript architect analyzing a dependency update.
You are given specific, isolated Usages of the dependency across a monorepo.

CRITICAL INSTRUCTIONS:
1. Analyze the 'usages' array to understand exactly how the dependency is used.
2. If an enclosing function is marked as 'isExported: true', changing its signature or return type is a high-risk BREAKING CHANGE to the rest of the monorepo.
3. Use the 'localCallers' array to understand the immediate localized data flow, as it shows where the enclosing function is called within the same file.
4. Respond with a technical analysis and specific, targeted code suggestions for any required fixes.`;

/**
 * Pure function that transforms raw AST `DependencyUsage` extractions
 * into a highly structured, token-efficient `GeminiPromptPayload`.
 */
export const buildGeminiPayload = (
	dependencyName: string,
	usages: DependencyUsage[],
): string => {
	const processedUsages: ProcessedUsage[] = usages.flatMap((usage) =>
		usage.usages.map((ctx) => {
			const enclosingFunc: ProcessedEnclosingFunction | null =
				ctx.enclosingFunction
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
					: null;

			return {
				file: usage.file,
				importStatement: usage.importStatement,
				callingStatement: ctx.statement,
				line: ctx.line,
				enclosingFunction: enclosingFunc,
			};
		}),
	);

	const payload: GeminiPromptPayload = {
		instruction: INSTRUCTION_TEXT,
		dependencyName,
		usages: processedUsages,
	};

	// We use standard JSON.stringify here instead of formatted space,
	// as this is for LLM API transport, minimizing string size/tokens.
	return JSON.stringify(payload);
};
