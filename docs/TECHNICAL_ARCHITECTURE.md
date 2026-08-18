# HZense — 技术架构文档

## HZense · Technology Intelligence — Technical Architecture

**版本：** v1.0  
**日期：** 2026-08-18  
**状态：** Architecture Baseline  
**品牌：** HZense  
**品牌标语：** Sense what matters in technology.

---

## 1. 架构目标

HZense 采用“Git/Markdown 为知识资产源，PostgreSQL 为索引与关系层，Next.js 为应用层”的混合架构。目标是保证内容长期可移植，同时支持 Search、Radar、Knowledge Graph、RAG 和自动技术情报处理。

> **Architecture-ready, not infrastructure-heavy.**

## 2. 首版冻结技术栈

| 层 | 技术 |
|---|---|
| Language | TypeScript |
| Web | Next.js + React + App Router |
| UI | Tailwind CSS + lightweight headless components |
| Content | Markdown / MDX + YAML Front Matter |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Vector | pgvector |
| Search | PostgreSQL FTS → Hybrid Search |
| Graph V1 | PostgreSQL relations |
| Graph V3 | Neo4j optional |
| AI | Provider abstraction + OpenAI first |
| Auth | Auth.js / Supabase Auth |
| Object Storage | Cloudflare R2 / S3-compatible |
| Hosting | Vercel |
| DB Hosting | Supabase / Neon |
| Source Control | GitHub |
| Automation | GitHub Actions + Scheduled Jobs |

## 3. Source of Truth

- **Git / Markdown** = 正式内容正文的 Source of Truth。
- **PostgreSQL** = Entity / Relation / Index / Radar / operational data 的 Source of Truth。
- 网站 = Presentation + Intelligence Application Layer。

不把所有关系塞进 YAML，也不把所有正式正文锁进数据库或 CMS。

## 4. 总体架构

```text
External Sources
Web / RSS / Papers / GitHub / Newsletters
        ↓
Ingestion Pipeline
fetch / parse / dedup / classify / entities
        ↓
Knowledge Layer
├── Git + Markdown / MDX
│   ├── Insights
│   ├── Daily
│   ├── Weekly
│   ├── Topics
│   ├── Briefings
│   └── Paper Notes
└── PostgreSQL
    ├── Entities
    ├── Relations
    ├── Signals Index
    ├── Radar History
    ├── Search Metadata
    └── Embeddings / pgvector
        ↓
Intelligence Layer
Search / Hybrid Retrieval / RAG / Entity Resolution
Topic Detection / Trend Analysis / Radar Calculation
        ↓
Next.js App
Home / HZense Daily / Topics / Insights / Weekly
Signals / Resources / Radar / Ask HZense
```

## 5. Web 与 UI

采用 Next.js + TypeScript + App Router。内容页面优先静态生成/缓存，Signals、Radar、Search 为动态数据，Ask HZense 为 AI Dynamic。

UI 使用 Tailwind CSS 和自建 Design System，可少量采用 Radix UI / shadcn/ui，但避免网站变成通用 SaaS 后台视觉。

## 6. 内容层

默认 Markdown，复杂交互才使用 MDX。正式内容目录：

```text
content/
├── insights/
├── daily/
├── weekly/
├── topics/
├── briefings/
└── papers/
```

所有内容使用统一 YAML Front Matter 和稳定唯一 ID。

## 7. PostgreSQL 数据域

Entities：Person、Company、Institution、Technology、Product、Paper、Topic。

Relations 示例：Person → works_at → Company；Company → develops → Technology；Paper → researches → Topic；Signal → mentions → Company；Insight → supports → Topic。

Operational Data：Signals、Radar snapshots、Search metadata、Ingestion jobs、Source status、Admin settings。

## 8. Search 与 Vector

V1 使用 PostgreSQL Full Text Search。V2 升级 Hybrid Search：Keyword + Vector + Entity + Recency + Importance。

向量首版直接使用 pgvector，不引入独立 Vector DB，除非规模与性能证明有必要。

## 9. Knowledge Graph

V1/V2 使用 PostgreSQL relations 表实现 Graph Model。只有在大量多跳查询、centrality、community detection、graph recommendation 和 graph analytics 出现后，V3 才考虑 Neo4j。

> **Graph Ready, PostgreSQL First.**

## 10. Ask HZense / RAG

```text
User Question
  ↓
Query Understanding
Topic / Entities / Time Range / Intent
  ↓
Hybrid Retriever
FTS / Vector / Entity / Relations
  ↓
Reranking
  ↓
Context Assembly
  ↓
LLM
  ↓
Answer + Citations
```

AI 层采用 Provider Abstraction，首版 OpenAI first，未来可扩展其他云端或本地模型。

## 11. 自动采集

```text
Scheduler → Fetcher → Extractor → Normalizer → Deduplicator
→ AI Classifier → Entity Extractor → Importance Scorer
→ Signal Inbox → Human Review
```

自动采集内容不得直接进入正式知识库，必须先进入 Signal Inbox。

## 12. HZense Daily 自动化

```text
Signals Today → Cluster by Topic → Rank → Select Important Events
→ Generate Summaries → Detect Emerging Patterns
→ Draft HZense Daily → Human Review → Publish Markdown → Git Commit
```

## 13. GitHub / Monorepo

推荐结构：

```text
tech-intelligence-hub/
├── apps/web/
├── content/
│   ├── insights/
│   ├── daily/
│   ├── weekly/
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
│   ├── taxonomy/
│   └── radar/
├── scripts/
│   ├── ingest/
│   └── migrate/
├── docs/
│   ├── DESIGN.md
│   ├── TECHNICAL_ARCHITECTURE.md
│   └── CONTENT_SCHEMA.md
├── db/
└── .github/workflows/
```

## 14. 部署

```text
GitHub
├── Vercel → Next.js
├── Supabase / Neon → PostgreSQL + pgvector
└── Cloudflare R2 → Images / Attachments
```

首版采用 Public Read + Admin Auth，不建设复杂多用户系统。

## 15. CMS 策略

不采用 Contentful、Strapi、Sanity 等传统 CMS 作为核心内容源。后续自建轻量 Intelligence Editor，最终写入 Markdown + Database。

## 16. 明确不在首版引入

- Neo4j
- Elasticsearch
- Kubernetes
- 微服务
- Kafka
- Redis Cluster
- 独立 Vector DB
- 独立 CMS

原则：保持核心简单、数据可移植、架构可扩展。

## 17. 演进路线

**V1 — Knowledge Hub**：Markdown + Next.js + PostgreSQL + Search。

**V2 — Intelligence Platform**：Signals + HZense Daily + Radar + Hybrid Search + Ask HZense / RAG。

**V3 — Intelligence Engine**：Automation + Graph + Trend Detection + Emerging Topic Detection + Recommendation。

**V4 — Personal Technology Intelligence OS**：Discover → Understand → Connect → Track → Predict。

## 18. 下一步

1. 建立 Repository Skeleton。
2. 创建 CONTENT_SCHEMA.md 和 taxonomy.yaml。
3. 定义 Entity / Relation Schema。
4. 初始化 Next.js + TypeScript + Tailwind + Drizzle。
5. 接 PostgreSQL。
6. 开始 HZense Website MVP。

---

> **HZense — Sense what matters in technology.**
