# HZense Development Foundation v1.0

Status: **implemented baseline** — 2026-08-20.

This foundation converts the design repository into an executable monorepo boundary before the Next.js MVP.

## Delivered

1. Repository skeleton: pnpm workspace + Turborepo, `apps/web`, `packages/content`, `packages/database`, search/intelligence/ui boundaries, content/data/db/scripts/workflows.
2. Physical data model: PostgreSQL + Drizzle schema and baseline SQL migration, including pgvector.
3. Executable content validation: Zod schemas for Daily, Weekly, Insight, Briefing, Topic and PaperNote plus a Markdown validator and unit tests.
4. Seed data: stable historical technology topics, entities, relations and signals plus representative Daily/Weekly/Insight/Topic Markdown.
5. Engineering baseline: strict TypeScript, ESLint, Prettier, Vitest, Playwright config, environment template and CI.

## First local bootstrap

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm content:validate
pnpm seed:validate
```

The first successful local install should commit `pnpm-lock.yaml`; CI can then switch from `--no-frozen-lockfile` to `--frozen-lockfile`.

## Next milestone

Initialize the actual Next.js application in `apps/web`, then implement Home + HZense Daily first.
