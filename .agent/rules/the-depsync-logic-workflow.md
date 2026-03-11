---
trigger: always_on
---

When implementing features, adhere strictly to this pipeline:
1. Discover target configurations using `@actions/glob` ONLY.
2. Parse typescript files using `ts-morph`.
3. NEVER send full files to the gemini llm. Surgically extract only the relevant typescript nodes (imports and their usages).
4. Generate structured json payloads for gemini.
5. Implement chatops: Use `@actions/github` to open a detailed issue in the monorepo. Wait for a `/fix` comment before mutating any code.