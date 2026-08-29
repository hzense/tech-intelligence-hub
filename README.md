<p align="center">
  <img src="assets/brand/hzense-logo.png" alt="HZense logo" width="180" />
</p>

# HZense

> **Sense what matters in technology.**

HZense is a Technology Intelligence platform for turning fragmented technical information into structured, versioned intelligence.

- Website: **https://hzense.com** _(production)_
- Vercel Production: **https://tech-intelligence-hub-web.vercel.app/**
- GitHub Organization: **https://github.com/hzense**
- Main Repository: **https://github.com/hzense/tech-intelligence-hub**

## Intelligence pipeline

> **Sources → Signals → HZense Daily → HZense Weekly → Topics → Insights → Radar**

Daily candidates are generated deterministically from reviewed Signals, validated as immutable artifacts and designed to open as Draft PRs; publication remains a human-only decision. Automatic PR creation is currently feature-gated by an organization policy. See [Continuous Daily](docs/CONTINUOUS_DAILY.md).

## Product modules

- **HZense Daily** — daily technology intelligence brief
- **HZense Weekly** — weekly synthesis
- **HZense Signals** — atomic technology signals
- **HZense Insights** — deep analysis and original judgments
- **HZense Topics** — evolving topic knowledge bases
- **HZense Radar** — attention, trend, maturity and strategic-value tracking
- **HZense Resources** — people, companies, institutions, technologies, products, models, datasets, standards/protocols, papers and events
- **Ask HZense** — future AI-powered intelligence retrieval and analysis

## Architecture baseline

- TypeScript
- Next.js + React
- Markdown / MDX as formal content source of truth
- PostgreSQL + Drizzle ORM for structured intelligence
- pgvector for semantic retrieval
- PostgreSQL FTS → Hybrid Search
- Vercel for the web application
- Cloudflare R2 / S3-compatible storage for large media

> **Git / Markdown = content Source of Truth**  
> **PostgreSQL = entity / relation / signal / index Source of Truth**

## Repository structure

```text
apps/
  web/                     # Next.js application boundary
content/
  daily/
  weekly/
  insights/
  topics/
  briefings/
  papers/
packages/
  content/                 # Zod schemas + Markdown validation
  database/                # Drizzle physical schema
  search/                  # search boundary
  intelligence/            # ranking / RAG / Radar boundary
  ui/                      # design-system boundary
data/
  schema/
  taxonomy/
  seed/
  radar/
db/
  migrations/
scripts/
docs/
  adr/
.github/
  workflows/
```

## Project baselines

- [`docs/DESIGN.md`](docs/DESIGN.md) — product and information architecture
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — technical architecture
- [`docs/INFORMATION_MODEL.md`](docs/INFORMATION_MODEL.md) — knowledge/data model
- [`docs/DEVELOPMENT_FOUNDATION.md`](docs/DEVELOPMENT_FOUNDATION.md) — executable engineering foundation
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment runbook
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — live development progress dashboard
- [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) — engineering rules
- [`docs/MVP_ACCEPTANCE.md`](docs/MVP_ACCEPTANCE.md) — V1 acceptance criteria
- [`data/schema/information-model.yaml`](data/schema/information-model.yaml) — machine-readable information model
- [`data/taxonomy/taxonomy.yaml`](data/taxonomy/taxonomy.yaml) — controlled taxonomy

## Current status

**Website MVP — release candidate**

Completed:

- [x] Product / brand / domain baseline
- [x] GitHub Organization and public Organization profile
- [x] Technical architecture
- [x] Information Model v2.0.0 and taxonomy
- [x] pnpm workspace + Turborepo repository skeleton
- [x] Strict TypeScript / ESLint / Prettier baseline
- [x] Vitest / Playwright baseline
- [x] PostgreSQL / Drizzle physical schema
- [x] pgvector-enabled migration baseline
- [x] Executable Zod Front Matter validation
- [x] Seed topics, entities, relations and historical signals
- [x] Seed Daily / Weekly / Insight / Topic Markdown
- [x] CI workflow baseline
- [x] Next.js Home, Daily, Weekly, Insights, Topics, Signals and Resources routes
- [x] Basic keyword search across published content
- [x] Architecture Decision Records

Next milestone:

- [x] Initialize the Next.js application in `apps/web`
- [x] Build Home + HZense Daily first
- [x] Deploy to Vercel
- [x] Bind `hzense.com` and redirect `www.hzense.com` to the apex domain
- [x] Add Insights list and detail routes
- [x] Add Topics list and detail routes
- [x] Add Weekly / Signals / Resources
- [x] Add basic search
- [x] Publish the dedicated HZense Radar route

Next phase:

- [x] Connect deterministic Daily candidate generation and validate a real dry-run artifact
- [ ] Enable organization policy for automatic Continuous Daily Draft PR creation
- [ ] Provision PostgreSQL / pgvector and production observability

## Local foundation checks

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm content:validate
pnpm seed:validate
```

The first dependency install should commit `pnpm-lock.yaml`. After that, CI should switch to a frozen lockfile install.

## Database migration contract

`packages/database/src/schema.ts` is the Drizzle physical-schema declaration. Executable migrations are reviewed, sequential `NNNN_name.sql` files in `db/migrations/`; `pnpm db:migrate` is the only migration command. The runner applies each file in a transaction, serializes concurrent runs, and records a SHA-256 checksum in `hzense_schema_migrations`. Applied files must never be edited.

For a new PostgreSQL database with pgvector available:

```bash
DATABASE_URL=postgresql://... pnpm db:migrate
```

An older database created directly from `0000_foundation.sql` has no migration-history row. Adopt it only after verifying that the exact checked-in file created the schema, then pass that file's SHA-256 as `HZENSE_DATABASE_BASELINE_CHECKSUM`. Unknown legacy Source, Signal, or Radar rows stop the evidence migration with their IDs so provenance can be backfilled explicitly.

---

**HZense — Technology Intelligence**  
_Sense what matters in technology._
