# HZense GitHub Organization Profile

This file is the source draft for the future public Organization profile at:

```text
https://github.com/hzense
```

When the public repository `hzense/.github` is created, copy the profile content below into:

```text
profile/README.md
```

---

# HZense

> **Sense what matters in technology.**

HZense is a **Technology Intelligence** platform for continuously discovering, organizing, connecting, interpreting, and tracking important changes across technology.

## What HZense does

HZense turns fragmented technology information into structured intelligence through the following pipeline:

> **Sources → Signals → Daily Intelligence → Weekly Intelligence → Topics → Insights → Radar**

Core products:

- **HZense Daily** — daily technology intelligence brief
- **HZense Weekly** — weekly synthesis and selected reading
- **HZense Signals** — atomic technology signals
- **HZense Insights** — deep analysis and original judgments
- **HZense Topics** — continuously evolving topic knowledge bases
- **HZense Radar** — trend, maturity, attention and strategic-value tracking
- **HZense Resources** — people, companies, institutions, technologies, products, models, datasets, standards, papers and events
- **Ask HZense** — AI-powered intelligence retrieval and analysis

## Official links

- Website: **https://hzense.com** _(production)_
- Main repository: **https://github.com/hzense/tech-intelligence-hub**

## Principles

- Keep formal knowledge assets portable in Git-managed Markdown/MDX.
- Keep entities, relations, signals, indexes and radar history queryable in PostgreSQL.
- Treat Signals, Knowledge, Insights and Intelligence as different layers.
- Use AI to assist research operations without removing human judgment from strategic interpretation.
- Keep the architecture extensible without making the infrastructure unnecessarily heavy.

## Architecture direction

```text
Git / Markdown
      +
PostgreSQL / pgvector
      +
Next.js
      +
Hybrid Search / RAG
      ↓
HZense Technology Intelligence
```

## Current stage

HZense is currently in the **production hardening / Runtime Reader rollout** phase. The public MVP and production domain are live; the first production Topic projection is independently verified, while Web Runtime database acceptance is still incomplete.

Completed:

- Product and brand baseline
- `hzense.com` registered
- HZense GitHub Organization established
- Main repository transferred to HZense
- Technical architecture baseline
- Information Model v2.0.0
- Initial technology taxonomy
- Public MVP and `hzense.com` production deployment
- PostgreSQL 18 / pgvector physical Schema and independently verified Topic projection
- Runtime Reader repository boundary and initial Neon governance preparation

Next milestone:

> **Merge Runtime Reader → finish least-privilege production configuration → verify health, bounded read and monitoring**

---

**HZense — Technology Intelligence**  
_Sense what matters in technology._
