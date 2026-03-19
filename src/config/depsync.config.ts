import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DepSyncConfigFile {
	coreFrameworks?: string[] | string;
}

export interface ResolvedDepSyncConfig {
	coreFrameworks: string[];
}

export interface ConfigDependencies {
	readFile: typeof readFile;
}

const defaultDependencies: ConfigDependencies = {
	readFile,
};

const DEFAULT_CORE_FRAMEWORKS: string[] = [
	"typescript",
	"react",
	"next",
	"@angular/core",
	"vue",
	"express",
	"fastify",
	"rxjs",
];

const normalizeFrameworks = (
	value: string[] | string | undefined,
): string[] => {
	if (!value) return [];

	const rawValues = Array.isArray(value) ? value : value.split(",");

	return Array.from(
		new Set(
			rawValues
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0),
		),
	);
};

const parseConfigFile = (content: string): DepSyncConfigFile => {
	const parsed: unknown = JSON.parse(content);

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new TypeError("depsync.config.json must contain a JSON object.");
	}

	return parsed as DepSyncConfigFile;
};

export const loadDepSyncConfig = async (
	workspaceRoot: string,
	coreFrameworksInput: string | undefined,
	deps: ConfigDependencies = defaultDependencies,
): Promise<ResolvedDepSyncConfig> => {
	let fileConfig: DepSyncConfigFile | undefined;

	try {
		const configPath = join(workspaceRoot, "depsync.config.json");
		const content = await deps.readFile(configPath, "utf-8");
		fileConfig = parseConfigFile(content);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			throw error;
		}
	}

	const fromInput = normalizeFrameworks(coreFrameworksInput);
	if (fromInput.length > 0) {
		return { coreFrameworks: fromInput };
	}

	const fromFile = normalizeFrameworks(fileConfig?.coreFrameworks);
	if (fromFile.length > 0) {
		return { coreFrameworks: fromFile };
	}

	return { coreFrameworks: DEFAULT_CORE_FRAMEWORKS };
};
