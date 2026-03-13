---
trigger: always_on
---

# Context: Project "depSync"
I am building a Context-Aware AI dependency manager for private and public monorepos. Unlike standard Dependabot, this tool uses `ts-morph` to extract the exact AST context of *where* and *how* updated packages are used. It then uses an LLM (Google Gemini/Jules) via API to analyze the impact and generate precise code fixes.

**Security & Architecture Constraints (CRITICAL):**
- Designed for zero-trust operational environments.
- Built as a Custom GitHub Action, packaged into a single static `dist/index.js` file using `@vercel/ncc` to prevent supply chain attacks.
- Uses the built-in `GITHUB_TOKEN` for execution.
- Operates on a Google AI Pro Plan (Strict limits: 15 requests per hour, 100 per day). Batching LLM calls is mandatory to prevent 429 errors.
- Code must be highly secure, performant (handling massive monorepos without memory leaks), and simple.

**Tech Stack:**
- **Language:** TypeScript (Strict mode)
- **Runtime:** Node.js (Action runs on `node24`)
- **Package Manager:** `pnpm`
- **Testing:** `vitest`
- **Linting & Formatting:** `Biome` (@biomejs/biome)
- **Core Libraries:** `@actions/core`, `@actions/github`, `@actions/glob`, `ts-morph`, `@google/genai`.

**Current Progress:**
1. Repository initialized with `pnpm`, `biome.json`, and `tsconfig.json`.
2. `action.yml` is set up to run `dist/index.js`.
3. `src/scanner.ts` efficiently finds `package.json` files using `@actions/glob`, safely ignoring `node_modules`.
4. `src/npm.ts` fetches registry data to detect version drift.
5. `src/ast.ts` is implemented to surgically extract `UsageContext` (statements and enclosing scopes) using `ts-morph` while maintaining a flat memory footprint.

**The Expected Workflow (Target Architecture):**
We are building a 6-step ChatOps pipeline:
1. **Detect Drift:** Scan the monorepo and detect npm version drifts for every package/service.
2. **Extract AST:** Use `ts-morph` to extract the relevant code sections where the outdated dependencies are used.
3. **Analyze & Report:** Send the findings to the LLM (dependency name, affected packages, and AST context). The Action must open **ONE issue per dependency**. This issue must aggregate all affected monorepo services, show code examples, explain breaking changes, and rate the upgrade difficulty.
4. **Alert (Issue):** Send a push notification (via webhook/fetch to Telegram/Email) alerting the user that a new dependency issue was opened, including details.
5. **ChatOps PR Generation:** If a user comments `/fix` on the issue, a separate GitHub Actions workflow triggers. It sends the context back to the LLM, which generates the actual code fixes, and the Action automatically opens a Pull Request.
6. **Alert (PR):** Send another push notification alerting the user that the PR is ready for review.

**Instructions for you:**
Act as a Senior TypeScript/Node.js Architect. I will provide you with specific tasks to build out this workflow. Your code must be production-ready, highly optimized for memory/performance, and strictly follow modern TypeScript practices. Whenever you provide code, briefly explain *why* it is the most efficient and secure approach.