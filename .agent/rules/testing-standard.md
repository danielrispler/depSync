---
trigger: always_on
---

Test-driven approach is mandatory. Write comprehensive unit tests for every utility and ast extraction logic using `vitest`. You must mock `@actions/core` and `@actions/github` to simulate the github actions environment. Tests must be fast, offline, and verify that ast parsing strictly extracts only the impacted nodes and nothing else.