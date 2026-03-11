---
trigger: always_on
---

SECURITY CRITICAL: The execution logs of this action will be visible. You MUST NOT use `console.log`, `core.info`, or any logging mechanism to output source code, file paths, or parsed ast nodes. Failures and errors must be caught gracefully without dumping stack traces that reveal internal private monorepo structures. All runtime code must be bundled into a single `dist/index.js` file using `@vercel/ncc` to prevent supply chain attacks via `npm install` at runtime.