import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

// ------------------------------------------------------------------
// Public types
// ------------------------------------------------------------------

export interface EnclosingFunction {
	/** Name of the function/method/class. Falls back to "anonymous". */
	name: string;
	/** Full signature text (params + return type), without the body. */
	signature: string;
	/** Complete body text, including braces, for full LLM context. */
	body: string;
	/** True if the function is exposed outside the file. */
	isExported: boolean;
}

export interface CallerContext {
	/** The exact statement node where the enclosing function is called. */
	statement: string;
	/** 1-indexed line number of the caller statement. */
	line: number;
	/** The function/class containing this caller, or null if module top-level. */
	enclosingFunction: EnclosingFunction | null;
}

export interface UsageContext {
	/** The exact statement node where the imported symbol is referenced. */
	statement: string;
	/** 1-indexed line number of the statement in the source file. */
	line: number;
	/** The function/method that contains this usage, or null if at module top-level. */
	enclosingFunction: EnclosingFunction | null;
	/** Places in the SAME FILE where this enclosing function is used/called. */
	localCallers: CallerContext[];
}

export interface DependencyUsage {
	/** Absolute path to the file. */
	file: string;
	/** All import statements for this package joined by newlines. */
	importStatement: string;
	/** One entry per unique calling statement. */
	usages: UsageContext[];
}

// ------------------------------------------------------------------
// Internal constants — defined once at module level to avoid
// re-allocating arrays on every invocation.
// ------------------------------------------------------------------

const STATEMENT_KINDS = [
	SyntaxKind.ExpressionStatement,
	SyntaxKind.VariableStatement,
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.ClassDeclaration,
	SyntaxKind.TypeAliasDeclaration,
	SyntaxKind.InterfaceDeclaration,
	SyntaxKind.PropertyDeclaration,
	SyntaxKind.MethodDeclaration,
	SyntaxKind.ReturnStatement,
	SyntaxKind.IfStatement,
	SyntaxKind.ForStatement,
	SyntaxKind.WhileStatement,
	SyntaxKind.ExportDeclaration,
	SyntaxKind.ExportAssignment,
];

const FUNCTION_KINDS = [
	SyntaxKind.FunctionDeclaration,
	SyntaxKind.FunctionExpression,
	SyntaxKind.ArrowFunction,
	SyntaxKind.MethodDeclaration,
	SyntaxKind.Constructor,
];

// ------------------------------------------------------------------
// Public factory
// ------------------------------------------------------------------

/**
 * Creates a lightweight ts-morph Project that avoids loading the full monorepo.
 *
 * CALLER RESPONSIBILITY: call `project.dispose()` once all files have been
 * processed to release the TypeScript compiler host and language service.
 */
export const createProject = (): Project =>
	new Project({
		skipAddingFilesFromTsConfig: true,
		skipFileDependencyResolution: true,
		useInMemoryFileSystem: false,
	});

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

/** Climbs to the closest enclosing statement or declaration node. */
const getSurgicalStatementNode = (node: Node): Node =>
	node.getFirstAncestor((a) => STATEMENT_KINDS.includes(a.getKind())) ?? node;

/**
 * Resolves a human-readable name from any function-like node.
 * Arrow functions and function expressions inherit the name from their
 * variable declarator parent.
 */
const getFunctionName = (funcNode: Node): string => {
	if (
		Node.isFunctionDeclaration(funcNode) ||
		Node.isMethodDeclaration(funcNode) ||
		Node.isFunctionExpression(funcNode)
	) {
		return funcNode.getName() ?? "anonymous";
	}
	if (Node.isConstructorDeclaration(funcNode)) return "constructor";
	// ArrowFunction: name comes from the VariableDeclaration parent.
	const varDecl = funcNode.getFirstAncestorByKind(
		SyntaxKind.VariableDeclaration,
	);
	return varDecl?.getName() ?? "anonymous";
};

/**
 * Splits a function-like node's text into its signature and body using
 * AST node positions — robust to any syntax style.
 */
const extractBodyAndSignature = (
	funcNode: Node,
): { signature: string; body: string } => {
	let bodyNode: Node | undefined;

	if (Node.isArrowFunction(funcNode)) {
		bodyNode = funcNode.getBody();
	} else if (
		Node.isFunctionDeclaration(funcNode) ||
		Node.isFunctionExpression(funcNode) ||
		Node.isMethodDeclaration(funcNode) ||
		Node.isConstructorDeclaration(funcNode)
	) {
		bodyNode = funcNode.getBody() as Node | undefined;
	}

	if (!bodyNode) {
		return { signature: funcNode.getText(), body: "" };
	}

	// Use absolute positions to reliably split signature from body.
	// getText() starts at getStart() (no leading trivia), so the offset
	// from funcNode.getStart() → bodyNode.getStart() is the signature length.
	const bodyOffset = bodyNode.getStart() - funcNode.getStart();
	const funcText = funcNode.getText();

	return {
		signature: funcText.slice(0, bodyOffset).trimEnd(),
		body: bodyNode.getText(),
	};
};

const getIsExported = (funcNode: Node): boolean => {
	let current: Node | undefined = funcNode;
	while (current && !Node.isSourceFile(current)) {
		if (Node.isExportable(current) && current.isExported()) {
			return true;
		}
		if (Node.isVariableDeclaration(current)) {
			const varStmt = current.getFirstAncestorByKind(
				SyntaxKind.VariableStatement,
			);
			if (varStmt && Node.isExportable(varStmt) && varStmt.isExported())
				return true;
		}
		current = current.getParent();
	}
	return false;
};

/**
 * Resolves the enclosing function for a given statement node.
 * Returns null if the statement is at module top-level.
 */
const getEnclosingFunction = (
	statementNode: Node,
): EnclosingFunction | null => {
	const funcNode = statementNode.getFirstAncestor((a) =>
		FUNCTION_KINDS.includes(a.getKind()),
	);
	if (!funcNode) return null;

	const { signature, body } = extractBodyAndSignature(funcNode);
	return {
		name: getFunctionName(funcNode),
		signature,
		body,
		isExported: getIsExported(funcNode),
	};
};

const getFunctionIdentifier = (funcNode: Node): Node | undefined => {
	if (
		Node.isFunctionDeclaration(funcNode) ||
		Node.isMethodDeclaration(funcNode) ||
		Node.isFunctionExpression(funcNode)
	) {
		return funcNode.getNameNode();
	}
	if (Node.isArrowFunction(funcNode)) {
		const varDecl = funcNode.getFirstAncestorByKind(
			SyntaxKind.VariableDeclaration,
		);
		return varDecl?.getNameNode();
	}
	return undefined;
};

const getLocalCallers = (funcNode: Node): CallerContext[] => {
	const callers: CallerContext[] = [];
	const idNode = getFunctionIdentifier(funcNode);
	if (idNode && Node.isIdentifier(idNode)) {
		const refs = idNode.findReferencesAsNodes();
		// filter out the declaration itself, and recursive calls from within funcNode itself
		const validRefs = refs.filter(
			(r) => r !== idNode && !r.getFirstAncestor((a) => a === funcNode),
		);

		for (const ref of validRefs) {
			const callerStatement = getSurgicalStatementNode(ref);
			callers.push({
				statement: callerStatement.getText(),
				line: callerStatement.getStartLineNumber(),
				enclosingFunction: getEnclosingFunction(callerStatement),
			});
		}
	}
	return callers;
};

/**
 * Builds a full UsageContext from a reference node, including line number
 * and complete enclosing function context.
 */
const buildUsageContext = (ref: Node): UsageContext => {
	const statementNode = getSurgicalStatementNode(ref);
	const enclosingFunction = getEnclosingFunction(statementNode);

	let localCallers: CallerContext[] = [];
	if (enclosingFunction) {
		const funcNode = statementNode.getFirstAncestor((a) =>
			FUNCTION_KINDS.includes(a.getKind()),
		);
		if (funcNode) {
			localCallers = getLocalCallers(funcNode);
		}
	}

	return {
		statement: statementNode.getText(),
		line: statementNode.getStartLineNumber(),
		enclosingFunction,
		localCallers,
	};
};

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Scans a SourceFile for every usage of `dependencyName` and returns a
 * structured payload for the LLM: the exact calling statement, its line
 * number, and the full body of the enclosing function for rich context.
 *
 * Returns null if `dependencyName` is not imported in this file at all,
 * or if it is imported but never referenced (e.g. an unused import).
 *
 * The caller owns the Project lifecycle and must call project.dispose().
 */
export const extractDependencyUsages = (
	sourceFile: SourceFile,
	dependencyName: string,
): DependencyUsage | null => {
	const targetImports = sourceFile
		.getImportDeclarations()
		.filter((imp) => imp.getModuleSpecifierValue() === dependencyName);

	if (targetImports.length === 0) return null;

	// Use statement AST position as dedup key: two usages on the exact same statement
	// (e.g. foo(bar())) share one UsageContext entry. Identical statements on different lines don't.
	const usageMap = new Map<number, UsageContext>();
	const importStmts: string[] = [];

	const addUsages = (refs: Node[]): void => {
		for (const ref of refs) {
			if (ref.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;

			const statementNode = getSurgicalStatementNode(ref);
			const key = statementNode.getStart();

			if (!usageMap.has(key)) {
				usageMap.set(key, buildUsageContext(ref));
			}
		}
	};

	for (const imp of targetImports) {
		importStmts.push(imp.getText());

		// 1. Named imports: import { foo, bar } from 'pkg'
		for (const namedImport of imp.getNamedImports()) {
			const nameNode = namedImport.getNameNode();
			// Guard: nameNode may be a StringLiteral for import { "foo" as bar } syntax.
			if (Node.isIdentifier(nameNode)) {
				addUsages(nameNode.findReferencesAsNodes());
			}
		}

		// 2. Default imports: import Foo from 'pkg'
		const defaultImport = imp.getDefaultImport();
		if (defaultImport) addUsages(defaultImport.findReferencesAsNodes());

		// 3. Namespace imports: import * as foo from 'pkg'
		const namespaceImport = imp.getNamespaceImport();
		if (namespaceImport) addUsages(namespaceImport.findReferencesAsNodes());
	}

	if (usageMap.size === 0) return null;

	return {
		file: sourceFile.getFilePath(),
		importStatement: importStmts.join("\n"),
		usages: Array.from(usageMap.values()),
	};
};
