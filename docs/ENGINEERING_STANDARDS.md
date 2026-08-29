# HZense Engineering Standards v1.0

- Runtime: Node.js 24; package manager: pnpm 11.
- Monorepo: pnpm workspaces + Turborepo.
- Language: TypeScript strict mode; no unchecked index access; exact optional properties.
- Formatting: Prettier. Linting: ESLint flat config + typescript-eslint.
- Unit tests: Vitest. Browser/E2E: Playwright once `apps/web` is initialized.
- Secrets: never commit `.env`; only `.env.example` is versioned.
- Branching: `main` must stay releasable; development uses short-lived feature branches and PRs. Protected `main` requires an up-to-date branch plus `foundation`, `database-migrations` and `daily-publication-gate`; Daily changes additionally require the declared CODEOWNER.
- Workflow security: top-level token access is read-only, write permissions are job-scoped, third-party Actions use immutable commit SHAs and every job has a timeout.
- Commits: concise imperative messages; one architectural concern per commit where practical.
- Data changes: migrations and their checksum manifest are append-only after review. Never edit a migration already applied in any shared environment. Production DDL requires the direct-endpoint preflight, a recoverable backup and the read-only post-verifier; the destructive integration suite is local CI only.
- Content changes: all Markdown front matter must pass `pnpm content:validate`.
- Seed changes: cross references must pass `pnpm seed:validate`.
- Dependency policy: prefer stable releases; upgrades are reviewed through CI rather than floating `latest` tags.
