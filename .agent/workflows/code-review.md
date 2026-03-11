---
description: General code review for any new or modified TypeScript code in the depSync project
---

# depSync Code Review Workflow

This workflow enforces the full quality gate before accepting any new code into the project.
It covers formatting, linting, type safety, test coverage, security conventions, and a build verification.

---

## Step 1: Auto-Format the Source

Run Biome's formatter across the entire `src/` directory to normalize whitespace, quotes, and indentation.

```bash
pnpm run format
```

⚠️ Verify there are zero rejected files in the output before proceeding.

---

## Step 2: Lint & Auto-Fix

Run Biome's linter in write mode so safe fixes are applied automatically. Unsafe fixes are not auto-applied — they will be flagged for manual review.

```bash
pnpm run lint
```

✅ Expected outcome: `Found 0 errors. Found 0 warnings.`

If warnings or errors remain after the auto-fix pass:
- Fix `noUnusedLocals` errors by either removing the variable or marking it as intentionally consumed with `void`.
- Fix import ordering violations by following Biome's alphabetical import sort.
- Do **NOT** suppress linting errors with inline disable comments unless there is an explicit architectural reason.

---

## Step 3: TypeScript Type Check

Run the TypeScript compiler in no-emit mode to catch all type errors.

```bash
pnpm run typecheck
```

✅ Expected outcome: Zero tsc errors.

Review checklist:
- All function signatures must be fully typed — no implicit `any`.  
- Every `catch (error)` block must use `unknown` (enforced via `useUnknownInCatchVariables`).
- No unused local variables (enforced via `noUnusedLocals`).
- All code paths in functions with non-void return types must return a value (enforced via `noImplicitReturns`).

---

## Step 4: Run Full Test Suite

Run all unit and integration tests. Both suites must fully pass.

```bash
pnpm run test
```

✅ Expected outcome: All test files pass with zero failures.

Review checklist:
- Every new module in `src/core/` or `src/clients/` must have a corresponding `*.test.unit.ts` file located under `src/<module-folder>/__tests__/`.
- Tests must be purely offline — no real network calls, no real file system access. All external interactions must be mocked via vitest's `vi.fn()` and dependency injection.
- Tests must verify the **zero-leakage** contract: if an error is swallowed, verify the logged message contains no file paths, stack traces, or sensitive data.
- Tests must verify **exclusion patterns** for scanner/glob logic to ensure `node_modules`, `dist`, `build`, and `.git` are never traversed.

To run unit tests only:
```bash
pnpm run test:unit
```

To run integration tests only:
```bash
pnpm run test:int
```

---

## Step 5: Manual Code Review Checklist

For each file changed, verify the following manually:

### Security (Zero-Leakage)
- [ ] No `console.log`, `core.info`, or any log statement outputs file paths, AST node contents, or parsed source code.
- [ ] All `catch` blocks log only a generic message — never `error.stack` or `error.message` if it could contain a file path.
- [ ] No hardcoded secrets, tokens, or API keys anywhere in source code.
- [ ] Inputs read via `core.getInput()` are never logged at any level.

### Functional Programming & Immutability
- [ ] `const` is used everywhere. `let` is only present if mutability is absolutely required (e.g., accumulator in a reduce).
- [ ] No imperative `for` or `while` loops. Use `map`, `filter`, `reduce`, `forEach` instead.
- [ ] Functions are pure where possible — same inputs always produce same outputs, no side effects.
- [ ] Mutable state (e.g., `Map`, `Set` construction) is isolated to a single function scope and not leaked.

### SOLID & Architecture
- [ ] Each new module has a single, clearly defined responsibility.
- [ ] Dependencies (filesystem, network, GitHub API, Gemini API) are injected via interface parameters — not imported directly inside business logic.
- [ ] No deep class hierarchies. Prefer plain functions and typed interfaces.
- [ ] No over-engineering: if a pattern adds complexity without a clear security or correctness benefit, simplify it.

### ts-morph / AST Logic (if applicable)
- [ ] AST extraction is surgical — only the minimal set of nodes (imports and their direct usages) is extracted and forwarded.
- [ ] The full source file text is **never** sent to the Gemini API. Only structured JSON payloads of extracted nodes.
- [ ] `Project` instances from `ts-morph` are disposed or scoped tightly to avoid memory leaks in large monorepos.

### npm / Registry Client (if applicable)
- [ ] Only the `Accept: application/vnd.npm.install-v1+json` header is sent — this fetches the minimal registry manifest (no full tarball metadata).
- [ ] Version comparison is deterministic and pure.
- [ ] Network errors are caught and re-thrown with a generic message that does not expose URLs or package names in logs.

---

## Step 6: Build Verification

Bundle the action into `dist/index.js` using `@vercel/ncc`. This is the final proof that all imports resolve and the action is shippable.

```bash
pnpm run build
```

✅ Expected outcome: `dist/index.js` and `dist/index.js.map` are generated with no errors.

Check:
- The build must complete without any `Module not found` errors.
- `dist/index.js` is a single self-contained CJS file — verify no `require()` calls reference paths outside `dist/`.

---

## Step 7: Final Confirmation

All six steps above must pass with zero errors before the code is considered reviewable. Summarize results:

| Check | Status |
|---|---|
| Format (`biome format`) | ✅ / ❌ |
| Lint (`biome check`) | ✅ / ❌ |
| Typecheck (`tsc`) | ✅ / ❌ |
| Tests (`vitest`) | ✅ / ❌ |
| Manual Review Checklist | ✅ / ❌ |
| Build (`ncc`) | ✅ / ❌ |

Do **not** deliver, commit, or open a PR for code that has any ❌ in the table above.
