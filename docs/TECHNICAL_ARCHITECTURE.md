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
- **PostgreSQL** = Entity / Relation / Index / Radar / operational data 的 Source of Truth；`topics` 是完整 Taxonomy 的派生投影，首次生产同步已于 2026-08-31 完成并独立验证。
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

同步器默认执行不持久化的 dry run：它输出只绑定权威投影的 source fingerprint，以及绑定当前数据库托管字段与 insert/update/no-op 计划的 plan fingerprint，在单一事务内执行拟议 DML 与校验后回滚；Apply 才提交同一事务。两种模式均复用 Migration advisory lock，只执行 insert/update。生产 Apply 在取得 advisory lock 与 table lock 后、写入前重新计算并同时匹配两个 reviewed fingerprint；数据库出现未知 Topic ID 或 dry run 后发生计划漂移时 fail closed，绝不自动删除。Apply 必须由独立的 `hzense_topic_sync` 角色执行，并携带操作者已经在 provider 侧验证的新备份 ID 声明；CLI 只检查声明格式与存在性，不能证明备份可恢复。Migrator、Topic Sync Writer 和 Runtime Reader 是三个互不复用的权限边界。

`runtime_enabled` 及其状态约束由 `0002_topic_projection.sql` 引入。2026-08-31 的生产维护窗口已完成新可恢复分支备份、`0002`、3 个 Migration / 0 pending、最小权限 `hzense_topic_sync`、dry run、受保护 Apply、独立只读验证与 0 变更 no-op 重跑。最终投影为 62 个 Topics、0 个未知行并匹配 reviewed fingerprint；仓库不记录实际备份标识、连接目标或凭据。

### 7.2 Runtime Reader 权限边界

Runtime Reader 使用固定角色 `hzense_runtime`，与 Migrator 和 Topic Sync Writer 完全分离。provider / 集群管理员负责预创建 `LOGIN NOINHERIT CONNECTION LIMIT 20 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` 的角色，并预置 `default_transaction_read_only = on`。仓库 [`configure_runtime_reader.sql`](../db/roles/configure_runtime_reader.sql) 不创建角色、不设置密码，也不会由受限数据库 owner 越权修改另一个角色的 session 默认值；[`runtime-reader-preflight.mjs`](../packages/database/src/runtime-reader-preflight.mjs) 只验证并 fail closed。

membership 合约按 profile 固定：本地与非生产必须为零；Neon Production 只允许 `cloud_admin` 将 `hzense_runtime` 授予 `neondb_owner` 的唯一管理边，精确要求 `ADMIN = true`、`INHERIT = false`、`SET = false`。这条 provider control-plane 边不能让 `neondb_owner` 继承或切换为 Runtime，也不会向 Runtime 传递 owner 能力；`ADMIN = true` 可转授 Runtime 角色，是被显式接受并在每次生产 preflight 中重新审计的 provider-governance residual。任何额外/反向 membership、身份或 option 漂移都会阻断 preflight。

Runtime Reader 的应用 Schema allowlist 只有目标数据库 `CONNECT`、`public` Schema `USAGE`、应用 enum type `topic_status` `USAGE`，以及 `topics(id, title, parent_id, status, runtime_enabled)` 五列的 column-level `SELECT`；其他应用 enum type 的默认 `PUBLIC USAGE` 会被撤销。`metadata`、Migration history、其他 HZense 表或列、应用 relation 写入、DDL、`TEMPORARY`、Sequence、应用 routine、数据库 / Migration owner 的未来对象 `PUBLIC` 默认权限、任何 principal 直接给 Runtime 的未来对象默认授权、应用对象 ownership 和 grant option 均不允许。其他可创建应用对象的 principal 仍需由外部 DDL 治理与冻结约束；preflight 拒绝最终产生的 Runtime 有效访问，但不重写所有 principal 的 `PUBLIC` defaults。只有经 dependency 证明的 `SECURITY INVOKER` pgvector functions 可保留 `PUBLIC EXECUTE`：普通合约要求 routine 与 extension 同 owner；Neon Production 窄合约精确固定 `vector 0.8.6`、routine owner `cloud_admin`、extension owner `neondb_owner`，并由已验证 Neon endpoint 的 runner 启用。现场 118 个 routines 全部位于 `public` Schema 且匹配，并且无 `SECURITY DEFINER`、grant option 或 Runtime direct ACL。routine 审计覆盖所有非系统 Schema，不依赖 Schema `USAGE`；任何版本、owner、dependency、security mode 或 ACL 漂移，任何非 pgvector 应用 routine、非系统 table-inheritance 边或可绕过应用表 ACL 的执行路径都会让 preflight 失败。

上述 Type denylist 只覆盖非系统应用 enums；provider-owned extension Types 与其他非-enum Types 不在声明内，仓库不声称移除了它们的 ambient PostgreSQL `USAGE`。它们不扩展固定五列查询。

由于角色与数据库 ACL 是 cluster-wide，每个普通非目标且 `datallowconn = true` 的数据库都必须让 `hzense_runtime` 的有效 `CONNECT`、`CREATE` 与 `TEMPORARY` 为 false。目标数据库 owner 不修改其他数据库；配置脚本与生产 preflight 只枚举并 fail closed。若 ambient `PUBLIC` 权限不能在保留其他调用方直接授权的前提下安全撤销，则本次上线阻断。

Neon 保留数据库只有精确匹配 provider 默认合约的 `postgres` 与 `template1` 可作为窄例外：owner 必须是 `cloud_admin`，模板标志、connection limit、default-vs-explicit ACL 形态、PUBLIC 能力、grant option 与 Runtime direct ACL 必须逐项匹配；`template0` 保持不可连接，`neondb` 及其他普通数据库不得豁免。生产 preflight 必须用 Runtime 凭据逐库连接并深检 identity、read-only/TLS、login event trigger 与非系统对象 access/ownership，而不是只按名称放行。任何 provider 默认或对象状态漂移都会阻断上线。

这不是数据库全局绝对只读证明：角色可覆盖 user-settable 的 read-only 默认值，且 `pg_catalog` Large Object 等系统接口可能允许普通登录创建其拥有的对象。Runtime 凭据仍必须作为高敏感值；需要全数据库不可写时，必须另行采用 provider 强制只读副本或管理员级系统函数 ACL 门禁。完整决策见 [ADR 0006](./adr/0006-runtime-reader-boundary.md)。

Web 只在 `VERCEL_ENV=production` 的请求时读取 `HZENSE_RUNTIME_DATABASE_URL` 与 expected host / port / database / user。连接必须使用显式端口、`sslmode=verify-full`、`channel_binding=prefer` 的官方 Neon pooled endpoint，固定用户为 `hzense_runtime`，驱动显式启用稳定版 `pg` 支持的 channel-binding preference，并拒绝 `NODE_TLS_REJECT_UNAUTHORIZED=0`；当前不声称尚未由稳定驱动实现的 require 语义。请求时延迟创建 server-only `pg.Pool`，进程池上限为 1，且只使用 PgBouncer 支持的 startup 参数；查询由客户端 timeout 限时。PostgreSQL major 与角色 connection limit 由部署前 preflight 验证，不在每个 Web 请求中重复查询。Preview、CI、构建期与非生产请求不初始化连接池并 fail closed。

唯一首批业务查询使用 `FROM ONLY public.topics` 固定选择上述五列，以 `runtime_enabled = true` 过滤、按 `id` 排序并使用 `1..50` 的参数化 `LIMIT`。Node.js 健康端点固定为 `/api/health/database`、动态执行、最长 10 秒且 `Cache-Control: no-store`；该上限覆盖 3.5 秒连接超时与 3 秒查询超时并保留平台收尾余量。项目级 [`apps/web/vercel.json`](../apps/web/vercel.json) 把 Function 固定到 `iad1`，不使用已弃用的 route-level region export。成功只暴露 `{"status":"ok"}`，失败只暴露 `{"status":"unavailable"}`。结构化日志仅包含事件、结果、耗时、request ID、安全错误码、SQLSTATE 和连接池计数，不记录 URL、host、database、user、SQL、参数或原始异常。

上述仓库边界已通过 PR #32–#35 合并并由 CI 验证，但不代表外部上线完成。Neon 侧已创建新的七天回滚分支，复核角色与 database ACL，设置 Runtime 的 read-only session 默认值，隔离未使用的 `neondb` ambient ACL；维护专用 `hzense_migrator` 因 Neon Tables 用满旧五连接上限而从 limit 5 调整为 10。后者不改变 Runtime 权限或 Web pool 上限 1。2026-09-01 的两组 catalog-only 查询已确认目标 `hzense` ACL 的有效权限与直接授权来源符合五列最小权限合约；[脱敏证据](./production-evidence/2026-09-01-runtime-reader-acl.md)不替代完整生产 preflight。独立 Runtime 凭据、生产 preflight、Vercel Production 变量、重部署、线上 health、真实五列查询和日志验证仍未完成。PR #36 合并后，小时级生产健康工作流只有在首次线上验收成功并设置 `PRODUCTION_DATABASE_HEALTH_ENABLED=true` 后才自动运行；在此之前仅允许受控手工触发。

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

1. ✅ 已完成：PR #30 完成 Topic 全量投影同步器的最终评审、CI 与合并。
2. ✅ 已完成：以经人工验证的新可恢复分支备份应用并验证生产 `0002`，配置独立 `hzense_topic_sync` 与 ACL，完成双 fingerprint dry run、受保护 Apply、独立验证与 no-op 重跑。
3. 🚧 进行中：Runtime Reader 代码、Neon 基础治理与目标 ACL 有界只读复核已完成；仍须建立独立凭据、通过目标库与保留库完整 preflight，并完成 Vercel Production 重部署和线上验收。
4. ⏳ 未执行：建立连接数、池等待、查询延迟、超时和错误告警，并执行一次上线后的告警基线验证。
5. ⏳ 未执行：在稳定数据路径上继续 PostgreSQL FTS、Hybrid Search 与 Ask HZense / RAG。

截至 2026-09-01，步骤 1–2 已完成并有独立生产证据。步骤 3 已完成代码、Neon 基础治理与目标 ACL 有界只读复核，但受保护凭据/完整 preflight、Vercel 配置、重部署与线上验收仍未完成。步骤 3–5 的其他外部动作不能用本地测试、基础治理或历史 Migration / Topic 验收替代。

---

## v1.1 域名与模型同步

- 正式生产域名锁定为 **hzense.com**。
- Canonical URL 锁定为 **https://hzense.com**。
- 增加生产、预览和本地环境的域名策略。
- 增加公共路由、`www` 重定向、HTTPS、canonical metadata、sitemap 和 robots 基线。
- 同步 Information Model v2.0.0 的证据契约、十类 Entity 与 Paper / PaperNote 边界。
- 更新开发启动前的下一步工程任务。

> **HZense — Sense what matters in technology.**
