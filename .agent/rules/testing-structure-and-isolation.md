---
trigger: always_on
---

All tests must be strictly located inside a `__tests__` directory. Test files must be categorized and named distinctly: use `*.test.unit.ts` for unit tests and `*.test.int.ts` for integration tests. Vitest must be configured to allow running these suites independently. Tests must be completely isolated, stateless, and mock external dependencies (like the GitHub Actions context or file system) to guarantee safe and fast parallel execution.