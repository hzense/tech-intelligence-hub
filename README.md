<p align="center">
  <img src="assets/brand/hzense-logo.png" alt="HZense logo" width="180" />
</p>

# HZense

> **Sense what matters in technology.**

HZense is a Technology Intelligence platform for turning fragmented technical information into structured, versioned intelligence.

- Website: **https://hzense.com** *(production)*
- Vercel Production: **https://tech-intelligence-hub-web.vercel.app/**
- GitHub Organization: **https://github.com/hzense**
- Main Repository: **https://github.com/hzense/tech-intelligence-hub**

## Intelligence pipeline

> **Sources → Signals → HZense Daily → HZense Weekly → Topics → Insights → Radar**

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

**Website MVP Alpha — in progress**

Completed:

- [x] Product / brand / domain baseline
- [x] GitHub Organization and public Organization profile
- [x] Technical architecture
- [x] Information Model v1.1 and taxonomy
- [x] pnpm workspace + Turborepo repository skeleton
- [x] Strict TypeScript / ESLint / Prettier baseline
- [x] Vitest / Playwright baseline
- [x] PostgreSQL / Drizzle physical schema
- [x] pgvector-enabled migration baseline
- [x] Executable Zod Front Matter validation
- [x] Seed topics, entities, relations and historical signals
- [x] Seed Daily / Weekly / Insight / Topic Markdown
- [x] CI workflow baseline
- [x] Next.js Home, Daily, Insights, Topics and validated Markdown runtime
- [x] Architecture Decision Records

Next milestone:

- [x] Initialize the Next.js application in `apps/web`
- [x] Build Home + HZense Daily first
- [x] Deploy to Vercel
- [x] Bind `hzense.com` and redirect `www.hzense.com` to the apex domain
- [x] Add Insights list and detail routes
- [x] Add Topics list and detail routes
- [ ] Add Weekly / Signals / Resources
- [ ] Add basic search

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

---

**HZense — Technology Intelligence**  
*Sense what matters in technology.*
