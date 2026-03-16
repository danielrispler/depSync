import type { GeminiPromptPayload as OrchestratorPayload } from "./orchestrator.utils.js";

/**
 * Represents the structured system instructions and context
 * provided to the Gemini model for analysis.
 */
export interface GeminiPromptPayload {
	instruction: string;
	dependencyName: string;
	releaseNotes: string | null;
	usages: ProcessedUsage[];
}

/**
 * A flatter, text-optimized version of the UsageContext
 * designed for maximum LLM comprehension and minimal token use.
 */
export interface ProcessedUsage {
	/** The monorepo service/app this usage belongs to */
	serviceName: string;
	/** Dense 1-sentence domain description of the service */
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

const INSTRUCTION_TEXT = `You are an expert migration assistant. The target dependency has breaking changes outlined in the [Release Notes]. The user's local service ([Service Description]) uses it as shown in the [AST Context]. Generate the exact code required to safely migrate the user's code to the new version.

CRITICAL INSTRUCTIONS:
1. Analyze the 'releaseNotes' to understand what changed in the dependency.
2. For each usage, check the 'serviceName' and 'serviceDescription' to understand the service's domain.
3. If an enclosing function is marked as 'isExported: true', changing its signature or return type is a high-risk BREAKING CHANGE to the rest of the monorepo.
4. Use the 'localCallers' array to understand the immediate localized data flow.
5. Respond with a technical analysis and specific, targeted code suggestions for any required fixes.`;

/**
 * Pure function that transforms raw orchestrator payloads (with service context)
 * into a highly structured, token-efficient JSON string for the LLM.
 */
export const buildGeminiPayload = (
	dependencyName: string,
	payloads: ReadonlyArray<OrchestratorPayload>,
	releaseNotes: string | null,
): string => {
	const processedUsages: ProcessedUsage[] = payloads.flatMap((payload) =>
		payload.usages.flatMap((usage) =>
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
					serviceName: payload.package.packageName,
					serviceDescription: payload.package.serviceDescription,
					file: usage.file,
					importStatement: usage.importStatement,
					callingStatement: ctx.statement,
					line: ctx.line,
					enclosingFunction: enclosingFunc,
				};
			}),
		),
	);

	const geminiPayload: GeminiPromptPayload = {
		instruction: INSTRUCTION_TEXT,
		dependencyName,
		releaseNotes,
		usages: processedUsages,
	};

	// We use standard JSON.stringify here instead of formatted space,
	// as this is for LLM API transport, minimizing string size/tokens.
	return JSON.stringify(geminiPayload);
};
