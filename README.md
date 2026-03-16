# depSync

**Context-Aware AI Dependency Manager for Monorepos.**

depSync is a custom GitHub Action that goes beyond simple version checks. Using `ts-morph`, it extracts the exact AST context of how updated packages are used in your monorepo, providing Jules AI (Google Gemini) with the precise information needed to analyze impact and generate surgical code fixes.

---

## 🚀 Features

- **AST-Powered Context**: Surgically extracts code sections where outdated dependencies are used.
- **AI Analysis**: Uses Google Gemini to explain breaking changes and rate upgrade difficulty.
- **ChatOps Workflow**: Open an issue for every dependency update; comment `/fix` to generate a PR with code fixes.
- **Zero-Trust Security**: Bundled into a single `dist/index.js` to prevent runtime supply chain attacks.
- **Push Notifications**: Real-time alerts via webhooks for new issues and PRs.

---

## 🛠 Project Structure

### Root
- `action.yml`: GitHub Action definition (inputs, Node.js runtime).
- `biome.json`: Configuration for Biome (linting and formatting).
- `tsconfig.json`: Strict TypeScript configuration.
- `vitest.config.ts`: Vitest configuration for unit and integration tests.

### Source (`src/`)
- `index.ts`: The main entry point and event router for the GitHub Action.

#### Clients (`src/clients/`)
- `changelog.ts`: Fetches and parses release notes/changelogs for dependencies.
- `github.ts`: Wrapper for GitHub API (Octokit) interactions.
- `jules.ts`: Client for communicating with the Jules AI (Gemini) API.
- `notifier.ts`: Sends push notifications to webhooks (Discord/Slack).
- `npm.ts`: Interacts with the npm registry to detect version drift.

#### Commands (`src/commands/`)
- `close.command.ts`: Logic for finalizing updates and cleaning up issue state.
- `fix.command.ts`: Orchestrates the AI-driven code fix generation and application.

#### Core (`src/core/`)
- `ast/ast.ts`: Core AST extraction engine using `ts-morph`.
- `orchestrator/orchestrator.ts`: Manages the high-level update lifecycle.
- `orchestrator/payload.ts`: Defines structured data models for AI communication.
- `orchestrator/orchestrator.utils.ts`: Internal helpers for orchestration logic.
- `scanner/scanner.ts`: Efficiently locates `package.json` files across the monorepo.

#### Workflows (`src/workflows/`)
- `chatops.workflow.ts`: Entry point for issue comment triggers (`/fix`).
- `cleanup.workflow.ts`: Pipeline for cleaning up when issues are closed.
- `scan.workflow.ts`: Main pipeline for scheduled monorepo drift detection.

#### Infrastructure & Types (`src/infrastructure/`, `src/types/`)
- `git.ts`: Robust wrapper for low-level Git operations (branch, commit, push).
- `drift.ts`: Type definitions for version drifts and package metadata.

---

## 📦 Usage

Add `depSync` to your `.github/workflows/depsync.yml`:

```yaml
name: depSync
on:
  schedule:
    - cron: '0 0 * * *'
  issue_comment:
    types: [created]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - name: depSync
        uses: ./
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          jules-api-key: ${{ secrets.JULES_API_KEY }}
          webhook-url: ${{ secrets.NOTIFIER_WEBHOOK }}
```

### Inputs
- `github-token`: (Required) GitHub token for API access.
- `jules-api-key`: (Required) API key for Jules (Gemini).
- `webhook-url`: (Optional) URL for Discord/Slack push notifications.

---

## 🧪 Development

### Install
```bash
pnpm install
```

### Test
```bash
pnpm test       # Run all tests
pnpm test:unit  # Unit tests only
```

### Lint
```bash
pnpm check      # Biome check & format
```

### Build
```bash
pnpm build      # Bundle to dist/index.js using ncc
```

---

## 🔒 Security
- **Strict Immutability**: Built with a functional programming mindset.
- **Zero-Leakage**: Internal paths and source code are never dumped into logs.
- **Single Artifact**: Minimal attack surface via pre-bundled execution.