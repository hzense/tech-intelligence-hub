# HZense Engineering Standards v1.0

- Runtime: Node.js 24; package manager: pnpm 11.
- Monorepo: pnpm workspaces + Turborepo.
- Language: TypeScript strict mode; no unchecked index access; exact optional properties.
- Formatting: Prettier. Linting: ESLint flat config + typescript-eslint.
- Unit tests: Vitest. Browser/E2E: Playwright once `apps/web` is initialized.
- Secrets: never commit `.env`; only `.env.example` is versioned.
- Branching: `main` must stay releasable; development uses short-lived feature branches and PRs. Enable branch protection after the first green CI run.
- Commits: concise imperative messages; one architectural concern per commit where practical.
- Data changes: migrations are append-only after production deployment. Never edit a migration already applied in production.
- Content changes: all Markdown front matter must pass `pnpm content:validate`.
- Seed changes: cross references must pass `pnpm seed:validate`.
- Dependency policy: prefer stable releases; upgrades are reviewed through CI rather than floating `latest` tags.
