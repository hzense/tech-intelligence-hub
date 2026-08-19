# HZense

> **Sense what matters in technology.**

**HZense** is a Technology Intelligence platform for continuously discovering, organizing, connecting, interpreting, and tracking important changes across technology.

**Official domain:** [hzense.com](https://hzense.com) *(registered; deployment pending)*  
**Canonical production URL:** `https://hzense.com`  
**GitHub organization:** `https://github.com/hzense`  
**Official repository:** `https://github.com/hzense/tech-intelligence-hub`

HZense is designed around a simple intelligence pipeline:

> **Sources → Signals → Daily Intelligence → Weekly Intelligence → Topics → Insights → Radar**

The goal is not to build another news feed or bookmark collection. HZense turns fragmented technical information into a long-lived, structured intelligence system.

## Brand and Domain

| Item | Value |
|---|---|
| Brand | HZense |
| Product category | Technology Intelligence |
| Tagline | Sense what matters in technology. |
| Primary domain | `hzense.com` |
| Canonical URL | `https://hzense.com` |
| GitHub organization | `github.com/hzense` |
| Official repository | `github.com/hzense/tech-intelligence-hub` |
| Domain status | Registered |
| Website status | Pre-MVP; deployment pending |

Planned public routes:

```text
https://hzense.com/
https://hzense.com/daily
https://hzense.com/weekly
https://hzense.com/signals
https://hzense.com/insights
https://hzense.com/topics
https://hzense.com/radar
https://hzense.com/resources
https://hzense.com/ask
```

## Product Modules

- **HZense Daily** — daily technology intelligence brief
- **HZense Weekly** — weekly synthesis and selected reading
- **HZense Signals** — atomic technology signals
- **HZense Insights** — deep analysis and original judgments
- **HZense Topics** — continuously evolving topic knowledge bases
- **HZense Radar** — technology attention, trend, maturity and strategic-value tracking
- **HZense Resources** — people, companies, institutions, technologies, products, models, datasets, standards/protocols, papers and events
- **Ask HZense** — future AI-powered intelligence retrieval and analysis

## Core Principles

1. **Knowledge assets must remain portable.** Formal long-form content lives in Git-managed Markdown/MDX.
2. **Structured intelligence must remain queryable.** Entities, relations, signals, indexes and radar history live in PostgreSQL.
3. **Signals are not insights.** Raw information moves through review, synthesis and analysis before influencing higher-level intelligence.
4. **Human judgment remains important.** AI assists collection, classification, extraction and drafting; strategic interpretation remains reviewable.
5. **Architecture-ready, not infrastructure-heavy.** Start simple and preserve clear upgrade paths for RAG, graph analytics and automation.

## Information Model

HZense currently defines ten primary entity types:

| Entity | Purpose |
|---|---|
| Person | Researchers, professors, founders, executives and other important people |
| Company | Commercial organizations and startups |
| Institution | Universities, laboratories, research institutes and public organizations |
| Technology | Technical concepts and technologies |
| Product | Commercial or operational technology products |
| Model | Named AI/ML or computational models |
| Dataset | Datasets, benchmarks and evaluation corpora |
| Standard / Protocol | Standards, protocols, specifications and interoperability frameworks |
| Paper | Objective scholarly works |
| Event | Conferences, launches, hearings, expos and other time-bounded events |

A **Paper** is an objective entity. HZense commentary about a paper is stored separately as **PaperNote** content.

## Technology Stack

Current architecture baseline:

- **Language:** TypeScript
- **Web:** Next.js + React
- **UI:** Tailwind CSS
- **Content:** Markdown / MDX
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Vector Search:** pgvector
- **Search:** PostgreSQL FTS → Hybrid Search
- **Graph v1:** PostgreSQL relations
- **Graph later:** Neo4j optional
- **AI:** provider abstraction, OpenAI first
- **Hosting:** Vercel
- **Database Hosting:** Supabase or Neon
- **Object Storage:** Cloudflare R2
- **Automation:** GitHub Actions + scheduled jobs

### Source of Truth

> **Git / Markdown = content Source of Truth**  
> **PostgreSQL = entity / relation / index Source of Truth**

## Repository Direction

```text
tech-intelligence-hub/
├── apps/
│   └── web/
├── content/
│   ├── daily/
│   ├── weekly/
│   ├── insights/
│   ├── topics/
│   ├── briefings/
│   └── papers/
├── packages/
│   ├── content/
│   ├── database/
│   ├── search/
│   ├── intelligence/
│   └── ui/
├── data/
│   ├── schema/
│   ├── taxonomy/
│   └── radar/
├── scripts/
├── docs/
└── .github/
```

The full repository skeleton will be created during the implementation phase.

## Project Baselines

- [`docs/DESIGN.md`](docs/DESIGN.md) — product vision, information architecture and implementation roadmap
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — technical architecture and technology decisions
- [`docs/INFORMATION_MODEL.md`](docs/INFORMATION_MODEL.md) — knowledge and data model
- [`data/schema/information-model.yaml`](data/schema/information-model.yaml) — machine-readable information model
- [`data/taxonomy/taxonomy.yaml`](data/taxonomy/taxonomy.yaml) — controlled technology taxonomy

## Current Status

**Foundation / pre-MVP**

Completed:

- [x] Product design baseline
- [x] HZense brand baseline
- [x] `hzense.com` primary domain registered
- [x] GitHub Organization `hzense` created
- [x] Main repository transferred to `hzense/tech-intelligence-hub`
- [x] ChatGPT GitHub App connected to the HZense Organization
- [x] Technical architecture baseline
- [x] Information Model v1.1
- [x] Initial taxonomy
- [x] Machine-readable schema

Next:

- [ ] HZense GitHub Organization profile (`hzense/.github`)
- [ ] Repository skeleton
- [ ] Seed data
- [ ] Database schema / migrations
- [ ] Executable content schema validation
- [ ] Next.js application skeleton
- [ ] First Vercel deployment and `hzense.com` binding
- [ ] HZense Daily MVP
- [ ] Insights / Topics / Weekly / Signals
- [ ] Search
- [ ] Radar
- [ ] Ask HZense

## Evolution

```text
V1  Knowledge Hub
        ↓
V2  Intelligence Platform
        ↓
V3  Intelligence Engine
        ↓
V4  Personal Technology Intelligence OS
```

Long-term direction:

> **Discover → Understand → Connect → Track → Predict**

---

**HZense — Technology Intelligence**  
*Sense what matters in technology.*
