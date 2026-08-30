# HZense — 技术架构文档

## HZense · Technology Intelligence — Technical Architecture

**版本：** v1.1  
**日期：** 2026-08-19  
**状态：** Architecture Baseline  
**品牌：** HZense  
**品牌标语：** Sense what matters in technology.  
**官方域名：** `hzense.com`  
**Canonical Production URL：** `https://hzense.com`

---

## 1. 架构目标

HZense 采用“Git/Markdown 为知识资产源，PostgreSQL 为索引与关系层，Next.js 为应用层”的混合架构。目标是保证内容长期可移植，同时支持 Search、Radar、Knowledge Graph、RAG 和自动技术情报处理。

> **Architecture-ready, not infrastructure-heavy.**

## 2. 首版冻结技术栈

| 层                | 技术                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Language          | TypeScript                                                         |
| Web               | Next.js + React + App Router                                       |
| UI                | Tailwind CSS + lightweight headless components                     |
| Content           | Markdown / MDX + YAML Front Matter                                 |
| Database          | PostgreSQL                                                         |
| ORM               | Drizzle ORM                                                        |
| Vector            | pgvector                                                           |
| Search            | PostgreSQL FTS → Hybrid Search                                     |
| Graph V1          | PostgreSQL relations                                               |
| Graph V3          | Neo4j optional                                                     |
| AI                | Provider abstraction + OpenAI first                                |
| Auth              | Auth.js / Supabase Auth                                            |
| Object Storage    | Cloudflare R2 / S3-compatible                                      |
| Hosting           | Vercel                                                             |
| DB Hosting        | Supabase / Neon                                                    |
| DNS               | Registrar DNS initially; Cloudflare DNS optional before production |
| Production Domain | `hzense.com`                                                       |
| Source Control    | GitHub                                                             |
| Automation        | GitHub Actions + Scheduled Jobs                                    |

## 3. Source of Truth

- **Taxonomy YAML** = Topic ID、英文规范名、primary parent 与跨域关系的 Source of Truth。
- **Seed Topics** = Taxonomy 的受控运行时子集，并拥有 Topic `status`。
- **Git / Markdown** = 正式内容正文与本地化 Topic 页面的 Source of Truth。
- **PostgreSQL** = Entity / Relation / Index / Radar / operational data 的 Source of Truth；`topics` 是完整 Taxonomy 的派生投影，仓库同步器已实现但生产同步尚未执行。
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
        ↓
Production
https://hzense.com
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

Entity 类型：Person、Company、Institution、Technology、Product、Model、Dataset、Standard / Protocol、Paper、Event。

Topic 作为受控分类与知识组织单元独立管理，不与 Entity 类型混淆。

Relations 示例：Person → works_at → Company；Company → develops → Technology；Model → trained_on → Dataset；Model → evaluated_on → Dataset；Product → uses → Model；Technology → implements → Standard / Protocol；Paper → presented_at → Event；Signal → mentions → Company；Insight → supports → Topic。

Operational Data：Signals、Radar snapshots、Search metadata、Ingestion jobs、Source status、Admin settings。

Paper 是客观论文 Entity；HZense 对论文的解读正文以 PaperNote Content 保存。

Drizzle Schema 描述当前物理模型；实际变更只通过 `db/migrations/` 中经过评审的顺序 SQL 执行。`pnpm db:migrate` 是生产安全入口，会先校验 direct endpoint、TLS、受限角色、pgvector 与迁移历史；本地开发必须显式使用 `pnpm db:migrate:local`。两者共享 PostgreSQL advisory lock、逐文件事务、不可变 checksum manifest 与 SHA-256 历史记录；已执行迁移不可修改。生产入口拒绝采纳未跟踪的旧 `0000` Schema；此类遗留库只能进入单独评审的 break-glass 流程，未知数据必须先补齐来源与证据字段。

### 7.1 Topic 派生投影

```text
data/taxonomy/taxonomy.yaml ─┐
data/seed/topics.yaml ───────┼─→ Authority + Content completeness gate
content/topics/**/*.{md,mdx} ─┘                 ↓
                              Deterministic projection + source fingerprint
                                                   ↓
                             Transactional plan + database-state fingerprint
                                                   ↓
                                         PostgreSQL public.topics
```

投影覆盖完整 Taxonomy。`id`、英文 `title` 与 `parent_id` 来自 Taxonomy；Seed 覆盖 `status`，Taxonomy-only Topic 回退为 `watching`；`runtime_enabled` 只在 Topic 存在于 Seed 且不是 archived 时为真。Content 只参与写前门禁，本地化字段和正文不进入数据库；跨域 Topic 关系本阶段继续只保存在 YAML。

同步器默认执行不持久化的 dry run：它输出只绑定权威投影的 source fingerprint，以及绑定当前数据库托管字段与 insert/update/no-op 计划的 plan fingerprint，在单一事务内执行拟议 DML 与校验后回滚；Apply 才提交同一事务。两种模式均复用 Migration advisory lock，只执行 insert/update。生产 Apply 在取得 advisory lock 与 table lock 后、写入前重新计算并同时匹配两个 reviewed fingerprint；数据库出现未知 Topic ID 或 dry run 后发生计划漂移时 fail closed，绝不自动删除。Apply 必须由独立的 `hzense_topic_sync` 角色执行，并携带操作者已经在 provider 侧验证的新备份 ID 声明；CLI 只检查声明格式与存在性，不能证明备份可恢复。Migrator、Topic Sync Writer 和未来 Runtime Reader 是三个互不复用的权限边界。

`runtime_enabled` 及其状态约束由 `0002_topic_projection.sql` 引入。仓库目标 Schema 已包含该 Migration，但截至 2026-08-30 生产仍只有此前验收的两个 Migration；必须先以 Migrator 应用并验证 `0002`，再使用 Topic Sync Writer 执行投影 DML。

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

Continuous Daily 的当前实现采用 `daily-v1` 确定性契约：以 Europe/Berlin 07:00 为每日 cutoff，从已审核 Signal 生成带证据和输入指纹的 `status: draft`，再由 Draft PR 承载人工事实核验、原创研判和发布状态切换。生成与发布分属只读/最小写权限 Job；机器人不得 mark ready、approve 或 merge。完整运行与回滚手册见 [`CONTINUOUS_DAILY.md`](./CONTINUOUS_DAILY.md)。

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
│   ├── schema/
│   ├── taxonomy/
│   └── radar/
├── scripts/
│   ├── ingest/
│   └── migrate/
├── docs/
│   ├── DESIGN.md
│   ├── TECHNICAL_ARCHITECTURE.md
│   ├── INFORMATION_MODEL.md
│   └── adr/
├── db/
└── .github/workflows/
```

## 14. 部署

```text
GitHub
├── Vercel → Next.js → hzense.com
├── Supabase / Neon → PostgreSQL + pgvector
└── Cloudflare R2 → Images / Attachments
```

首版采用 Public Read + Admin Auth，不建设复杂多用户系统。

### 14.1 域名与路由策略

生产环境唯一主域名：

```text
https://hzense.com
```

域名规则：

- `hzense.com` 是唯一 Canonical Host。
- `www.hzense.com` 使用永久重定向跳转到 `https://hzense.com`。
- Vercel Preview URL 仅用于开发、测试和 PR 预览，不参与搜索引擎索引。
- 所有生产页面输出指向 `https://hzense.com` 的 canonical metadata。
- 强制 HTTPS，并启用 HSTS 前先完成域名、证书和回滚验证。
- DNS 供应商不在架构阶段强制锁定；首个部署可直接使用注册商 DNS，生产稳定前可评估迁移至 Cloudflare DNS。

公共路由基线：

```text
/             Home
/daily        HZense Daily
/weekly       HZense Weekly
/signals      HZense Signals
/insights     HZense Insights
/topics       HZense Topics
/radar        HZense Radar
/resources    HZense Resources
/ask          Ask HZense
```

环境域名策略：

```text
Production    https://hzense.com
Preview       Vercel-generated preview URL
Local         http://localhost:3000
```

首次 MVP 部署时完成：Vercel Project 绑定、DNS 记录配置、SSL 验证、`www` 重定向、canonical metadata、sitemap 和 robots 配置。

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

1. 完成 Topic 全量投影同步器的最终评审、CI 与合并。
2. 以经人工验证的新备份应用并验证生产 `0002`，再用独立 `hzense_topic_sync` 角色完成双 fingerprint dry run、受保护 Apply、独立验证与 no-op 重跑。
3. 评审并配置独立 Runtime Reader、Server-only 客户端、安全健康检查和一条有上限的真实只读查询。
4. 建立连接数、池等待、查询延迟、超时和错误告警。
5. 在稳定数据路径上继续 PostgreSQL FTS、Hybrid Search 与 Ask HZense / RAG。

截至 2026-08-30，步骤 1 的仓库实现位于待合并分支；步骤 2–5 均未完成，不能用本地测试或历史 Migration 验收替代生产证据。

---

## v1.1 域名与模型同步

- 正式生产域名锁定为 **hzense.com**。
- Canonical URL 锁定为 **https://hzense.com**。
- 增加生产、预览和本地环境的域名策略。
- 增加公共路由、`www` 重定向、HTTPS、canonical metadata、sitemap 和 robots 基线。
- 同步 Information Model v2.0.0 的证据契约、十类 Entity 与 Paper / PaperNote 边界。
- 更新开发启动前的下一步工程任务。

> **HZense — Sense what matters in technology.**
