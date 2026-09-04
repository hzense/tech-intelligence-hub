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

HZense is currently in the **production hardening / post-rollout monitoring** phase. The public MVP, production domain, first production Topic projection and Web Runtime database path are live and independently verified.

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
- Runtime Reader least-privilege Neon/Vercel production rollout, bounded read acceptance, hourly health gate and production-verified singleton incident/recovery alerting
- Forward-only Runtime ACL baseline/session guard merged and deployment-verified without production capture, provider-backup verification or database mutation
- FTS-0 canonical Search Document projection, deterministic in-process ranking contract and exact-commit production compatibility acceptance

Next milestone:

> **Use the merged PR #42 tooling to close the still-unresolved Runtime ACL recovery-evidence gap in a future protected window → add provider-side database-capacity telemetry beyond the accepted PR #40 application alert → deliver FTS-1 database persistence, indexing, parity and production cutover after the accepted PR #41 FTS-0 contract → unblock Continuous Daily at organization level → retire the public Hosted Alpha after explicit authorization**

An existing credential-handling exposure risk had already created the normal rotation trigger. On 2026-09-04, the operator knowingly chose to defer that rotation for this work cycle without reading or changing the credential/configuration. This is a recorded acceptance of the residual, not a completed rotation or a lower classification: the credential remains highly sensitive and the protected rotation obligation remains open. The sanitized state is recorded in the [operations checkpoint](./production-evidence/2026-09-04-operations-checkpoint.md).

---

**HZense — Technology Intelligence**  
_Sense what matters in technology._
