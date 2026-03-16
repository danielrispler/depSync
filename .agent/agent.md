# Agent Rules for depSync

This project follows a strict set of architectural and security constraints. Every AI agent interacting with this codebase MUST adhere to these rules.

## 1. Functional Programming & Immutability
- **Paradigm**: Prioritize functional programming.
- **State**: Avoid mutable state. Use `const` over `let`.
- **Loops**: Avoid `for`/`while`. Use declarative methods: `map`, `filter`, `reduce`, `forEach`.
- **Purity**: Keep functions pure and side-effect-free wherever possible.

## 2. Security & Zero-Leakage
- **No Direct Logs**: Never use `console.log` or `core.info` to output source code, file paths, or AST nodes.
- **Error Handling**: Catch errors gracefully without dumping stack traces that reveal internal monorepo structure.
- **Supply Chain**: All code must be compatible with `@vercel/ncc` bundling into a single `dist/index.js`.

## 3. AST-First Context
- **Tooling**: Strictly use `ts-morph` for code analysis.
- **Efficiency**: Never send full files to the LLM. Surgically extract only impacted nodes (imports and their usage context).
- **Batching**: Group AI calls to respect strict rate limits (15/hour, 100/day).

## 4. Quality Standards
- **Testing**: TDD is mandatory. Use `vitest` in `__tests__` directories.
- **Linting**: No delivery of code with Biome errors or warnings.
- **Types**: Strict-mode TypeScript only. No implicit `any`.

## 5. Deployment Workflow
- **ChatOps**: Issues First. Never mutate code before a `/fix` command is received on a GitHub Issue.
- **Git**: Use the `src/infrastructure/git.ts` wrapper for all Git mutations to ensure consistency and proper authentication.
