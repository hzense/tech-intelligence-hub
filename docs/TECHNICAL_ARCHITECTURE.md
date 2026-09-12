# HZense — 技术架构文档

## HZense · Technology Intelligence — Technical Architecture

**版本：** v2.0 目标架构整合稿

**日期：** 2026-09-12

**状态：** 目标设计待实施；现行物理与权限契约另有明确标注

**品牌：** HZense  
**品牌标语：** Sense what matters in technology.  
**官方域名：** `hzense.com`  
**Canonical Production URL：** `https://hzense.com`

---

> **文档职责：** [DESIGN](DESIGN.md) 是产品总纲，[Signal-first v2](SIGNAL_FIRST_REDESIGN.md) 定义页面、人物、评分与迁移，[AI 自主 Signal 专项设计](AUTONOMOUS_SIGNAL_PIPELINE.md) 保留并整合初版专项契约 `b5a0045` 的完整 AI／来源／导入／任务／发布能力。本页描述其目标架构；所有目标功能均待实施。第 7.1–7.2 节保留既有数据库投影／权限基线，不能因新设计而放宽；已实现物理结构以 [Information Model 第 40 节](INFORMATION_MODEL.md#40-postgresql-物理数据库设计) 为准。

## 1. 架构目标

目标是“PostgreSQL 保存版本化 Signal／人物／组织／证据／专题洞察，Git 保存代码、Taxonomy、历史内容与导出，Next.js 提供公开页面和后台，Worker 执行 AI 生产”。数据库权威与自动发表尚未切换，当前 Seed／Markdown 读取继续按既有契约运行。

> **Architecture-ready, not infrastructure-heavy.**

## 2. 技术栈基线与目标能力

继续使用现有 TypeScript、Next.js、PostgreSQL、Drizzle 和 Vercel Web。下表中的 AI／Auth／对象存储／Worker 选型不是已开通资源，实施前按专项能力测试确定，不因文档整合切换平台。

| 层                | 技术                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Language          | TypeScript                                                         |
| Web               | Next.js + React + App Router                                       |
| UI                | Tailwind CSS + lightweight headless components                     |
| Content           | 新版数据库不可变正文／证据版本；Markdown / MDX 历史档案与导出      |
| Database          | PostgreSQL                                                         |
| ORM               | Drizzle ORM                                                        |
| Vector            | pgvector                                                           |
| Search            | In-process keyword ranking → PostgreSQL FTS → Hybrid Search        |
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

- **切换前**：公开 Signal 使用 Seed，现有正文使用 Git／Markdown；不得在后台启用第二套正式写入源。
- **Taxonomy YAML** = Topic ID、英文规范名、primary parent 与跨域关系的 Source of Truth。
- **Seed Topics** = Taxonomy 的受控运行时子集，并拥有 Topic `status`。
- **切换后的 PostgreSQL 业务层** = Signal、人物／组织、证据关系、专题洞察正文版本与运行配置的权威；搜索、趋势和活跃度为可重建投影，不是第二套事实源。
- **Git / Markdown** = 代码、迁移、Taxonomy、旧 Daily／Weekly／Insight 档案和可移植导出；本地化 Topic 内容在其适配迁移前仍依现行契约，不由 AI 随意改写。
- **PostgreSQL `topics`** = Taxonomy 的派生投影，既有投影规则继续生效；新洞察版本不自行创建不受控 Topic 身份。
- 网站 = Presentation + Intelligence Application Layer。

新正文在数据库版本化保存，但提供可移植导出；不能继续把“所有正式正文只能在 Git”作为新产品约束。Source of Truth 变化需按 Information Model 第 42 节单独升级模型主版本、迁移和验证，不把产品代号 v2 等同于现行信息模型版本。

## 4. 总体架构

```text
管理后台：来源配置 / 文件与 OCR 批量导入 / 链接提交 / AI Profile
                         ↓
持久化任务与 Worker：抓取 / 解析 / 去重 / 人物消歧 / 证据核验 / 研判
                         ↓
当前权限与机器发布规则 → 不可变 Signal 版本 + 事务 Outbox
                         ↓
公开信号 / 自动搜索投影 / 人物与组织 / 活跃度 / 趋势 / 热点 TOP 10
                         ↓
周度或手动专题分析 → 固定输入证据 → 洞察版本 → 按专题策略发布
                         ↓
Next.js：雷达首页 / 信号 / 专题洞察 / 资源 / 搜索

Git Taxonomy → 受控 Topic 投影；Git 旧内容 → 历史只读路由
原始上传材料 → 私有对象存储；公开视图不暴露原件或任务秘密
```

## 5. Web 与 UI

采用 Next.js + TypeScript + App Router。公开读服务在服务器端获取当前有效版本，客户端负责筛选和图表交互；后台写接口独立鉴权。缓存有明确版本、失效与有界过期，不能长期保留被撤回的正文。长时采集和模型调用由后台 Worker 处理，访客读取已保存结果，不在访问时重新生成。

UI 使用 Tailwind CSS 和自建 Design System，可少量采用 Radix UI / shadcn/ui，但避免网站变成通用 SaaS 后台视觉。

## 6. 内容层与历史兼容

新版 Signal 研判和专题洞察正文保存为数据库不可变版本，关联运行、模型、费用和证据版本；导出 Markdown 便于迁移，但不是平行写入源。现行 Git 内容目录保留：

```text
content/
├── insights/
├── daily/
├── weekly/
├── topics/
├── briefings/
└── papers/
```

历史内容继续使用既有 Front Matter 校验及稳定 ID。Daily／Weekly 在新版切换后停止新增；旧 Insight 逐条映射到专题洞察版本或保留只读原页，不因导航合并丢失正文。

## 7. PostgreSQL 数据域

Entity 类型：Person、Company、Institution、Technology、Product、Model、Dataset、Standard / Protocol、Paper、Event。

Topic 作为受控分类与知识组织单元独立管理，不与 Entity 类型混淆。

Relations 示例：Person → works_at → Company；Company → develops → Technology；Model → trained_on → Dataset；Model → evaluated_on → Dataset；Product → uses → Model；Technology → implements → Standard / Protocol；Paper → presented_at → Event；Signal → mentions → Company；Insight → supports → Topic。

目标 Operational Data 包括 Signal／洞察版本、来源证据、人物任职、导入批次、AI 配置、任务／步骤／用量、Outbox 与评分投影；未实现对象清单见专项设计，不能从此列表推断已建表。

Paper 是客观论文 Entity；HZense 对论文的解读正文以 PaperNote Content 保存。

Drizzle Schema 描述当前物理模型；实际变更只通过 `db/migrations/` 中经过评审的顺序 SQL 执行。`pnpm db:migrate` 是生产安全入口，会先校验 direct endpoint、TLS、受限角色、pgvector 与迁移历史；本地开发必须显式使用 `pnpm db:migrate:local`。两者共享 PostgreSQL advisory lock、逐文件事务、不可变 checksum manifest 与 SHA-256 历史记录；已执行迁移不可修改。生产入口拒绝采纳未跟踪的旧 `0000` Schema；此类遗留库只能进入单独评审的 break-glass 流程，未知数据必须先补齐来源与证据字段。

### 7.1 Topic 派生投影

以下保留现行投影契约，新版适配迁移前继续生效。

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

以下为既有 Topic Reader 的权限基线／历史验收记录，不是新增 AI 写角色的授权清单，也不替代后来 FTS-1 的独立列权限契约。新版角色须在实现时同步迁移、verifier 与 ACL；不能直接复制 Reader 或 Migrator 为 Worker 写入身份。

Runtime Reader 使用固定角色 `hzense_runtime`，与 Migrator 和 Topic Sync Writer 完全分离。provider / 集群管理员负责预创建 `LOGIN NOINHERIT CONNECTION LIMIT 20 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` 的角色，并预置 `default_transaction_read_only = on`。仓库 [`configure_runtime_reader.sql`](../db/roles/configure_runtime_reader.sql) 不创建角色、不设置密码，也不会由受限数据库 owner 越权修改另一个角色的 session 默认值；[`runtime-reader-preflight.mjs`](../packages/database/src/runtime-reader-preflight.mjs) 只验证并 fail closed。

membership 合约按 profile 固定：本地与非生产必须为零；Neon Production 只允许 `cloud_admin` 将 `hzense_runtime` 授予 `neondb_owner` 的唯一管理边，精确要求 `ADMIN = true`、`INHERIT = false`、`SET = false`。这条 provider control-plane 边不能让 `neondb_owner` 继承或切换为 Runtime，也不会向 Runtime 传递 owner 能力；`ADMIN = true` 可转授 Runtime 角色，是被显式接受并在每次生产 preflight 中重新审计的 provider-governance residual。任何额外/反向 membership、身份或 option 漂移都会阻断 preflight。

Runtime Reader 的应用 Schema allowlist 只有目标数据库 `CONNECT`、`public` Schema `USAGE`、应用 enum type `topic_status` `USAGE`，以及 `topics(id, title, parent_id, status, runtime_enabled)` 五列的 column-level `SELECT`；其他应用 enum type 的默认 `PUBLIC USAGE` 会被撤销。`metadata`、Migration history、其他 HZense 表或列、应用 relation 写入、DDL、`TEMPORARY`、Sequence、应用 routine、数据库 / Migration owner 的未来对象 `PUBLIC` 默认权限、任何 principal 直接给 Runtime 的未来对象默认授权、应用对象 ownership 和 grant option 均不允许。其他可创建应用对象的 principal 仍需由外部 DDL 治理与冻结约束；preflight 拒绝最终产生的 Runtime 有效访问，但不重写所有 principal 的 `PUBLIC` defaults。只有经 dependency 证明的 `SECURITY INVOKER` pgvector functions 可保留 `PUBLIC EXECUTE`：普通合约要求 routine 与 extension 同 owner；Neon Production 窄合约精确固定 `vector 0.8.6`、routine owner `cloud_admin`、extension owner `neondb_owner`，并由已验证 Neon endpoint 的 runner 启用。现场 118 个 routines 全部位于 `public` Schema 且匹配，并且无 `SECURITY DEFINER`、grant option 或 Runtime direct ACL。routine 审计覆盖所有非系统 Schema，不依赖 Schema `USAGE`；任何版本、owner、dependency、security mode 或 ACL 漂移，任何非 pgvector 应用 routine、非系统 table-inheritance 边或可绕过应用表 ACL 的执行路径都会让 preflight 失败。

上述 Type denylist 只覆盖非系统应用 enums；provider-owned extension Types 与其他非-enum Types 不在声明内，仓库不声称移除了它们的 ambient PostgreSQL `USAGE`。它们不扩展固定五列查询。

由于角色与数据库 ACL 是 cluster-wide，每个普通非目标且 `datallowconn = true` 的数据库都必须让 `hzense_runtime` 的有效 `CONNECT`、`CREATE` 与 `TEMPORARY` 为 false。目标数据库 owner 不修改其他数据库；配置脚本与生产 preflight 只枚举并 fail closed。若 ambient `PUBLIC` 权限不能在保留其他调用方直接授权的前提下安全撤销，则本次上线阻断。

Neon 保留数据库只有精确匹配 provider 默认合约的 `postgres` 与 `template1` 可作为窄例外：owner 必须是 `cloud_admin`，模板标志、connection limit、default-vs-explicit ACL 形态、PUBLIC 能力、grant option 与 Runtime direct ACL 必须逐项匹配；`template0` 保持不可连接，`neondb` 及其他普通数据库不得豁免。生产 preflight 必须用 Runtime 凭据逐库连接并深检 identity、read-only/TLS、login event trigger 与 provider catalog，而不是只按名称放行。单条 catalog 查询为两库生成不可互换的精确合约：`postgres` 固定 409 项 access、3 extensions、3 non-system Schemas、11 Relations、88 Columns、4 Indexes、1 Sequence、32 Routines、22 Types、1 Collation、1 extension Language、3 条 operator-class 支撑路径、290 项 system-object 状态、3 项 system-Schema 状态和 2 项 cluster ACL 状态；`template1` 固定 298 项 access、1 extension、1 non-system Schema、3 Routines、1 extension Language、289 项 system-object 状态、3 项 system-Schema 状态和 2 项 cluster ACL 状态，其余对象类为 0。两库都固定 0 residual Runtime ownership、access-method、event-trigger、inheritance、operator、cast、conversion 与 text-search paths；cluster ACL 固定内置 tablespace 并覆盖 PG18 parameter ACL 的能力。每类用 `C` 排序 SHA-256 和数量同时校验，覆盖 normal-OID/extension-backed system 对象、非系统对象、对象结构/定义、安全属性、依赖、Runtime 有效权限、grant option、direct ACL、system-object 显式 ACL、全 catalog Runtime ownership 与 system-Schema 能力；临时 Schema 对象被排除。任一已纳入字段漂移、同数量替换或新增普通 OID/已枚举路径都会 fail closed，且不按 `cloud_admin` 或名称前缀泛化。低 OID PostgreSQL 内置对象定义与 provider 原生实现仍是 database-global residual；其显式 ACL、Runtime ownership、grant option 和 system-Schema 能力漂移已由精确合约覆盖。

这不是数据库全局绝对只读证明：角色可覆盖 user-settable 的 read-only 默认值，且 `pg_catalog` Large Object 等系统接口可能允许普通登录创建其拥有的对象。Runtime 凭据仍必须作为高敏感值；需要全数据库不可写时，必须另行采用 provider 强制只读副本或管理员级系统函数 ACL 门禁。完整决策见 [ADR 0006](./adr/0006-runtime-reader-boundary.md)。

Web 只在 `VERCEL_ENV=production` 的请求时读取 `HZENSE_RUNTIME_DATABASE_URL` 与 expected host / port / database / user。连接必须使用显式端口、`sslmode=verify-full`、`channel_binding=prefer` 的官方 Neon pooled endpoint，固定用户为 `hzense_runtime`，驱动显式启用稳定版 `pg` 支持的 channel-binding preference，并拒绝 `NODE_TLS_REJECT_UNAUTHORIZED=0`；当前不声称尚未由稳定驱动实现的 require 语义。请求时延迟创建 server-only `pg.Pool`，进程池上限为 1，且只使用 PgBouncer 支持的 startup 参数；查询由客户端 timeout 限时。PostgreSQL major 与角色 connection limit 由部署前 preflight 验证，不在每个 Web 请求中重复查询。Preview、CI、构建期与非生产请求不初始化连接池并 fail closed。

唯一首批业务查询使用 `FROM ONLY public.topics` 固定选择上述五列，以 `runtime_enabled = true` 过滤、按 `id` 排序并使用 `1..50` 的参数化 `LIMIT`。Node.js 健康端点固定为 `/api/health/database`、动态执行、最长 10 秒且 `Cache-Control: no-store`；该上限覆盖 3.5 秒连接超时与 3 秒查询超时并保留平台收尾余量。项目级 [`apps/web/vercel.json`](../apps/web/vercel.json) 把 Function 固定到 `iad1`，不使用已弃用的 route-level region export。成功只暴露 `{"status":"ok"}`，失败只暴露 `{"status":"unavailable"}`。总健康耗时达到五秒即 fail closed；SQLSTATE `53300` / `57014` 分别分类为连接容量 / 查询取消，其他查询异常保持通用分类。结构化日志仅包含事件、结果、耗时、request ID、安全错误码、SQLSTATE 和连接池计数，不记录 URL、host、database、user、SQL、参数或原始异常；局部池计数本身不改变公开健康结果。

上述仓库边界已通过 PR #32–#35 合并并由 CI 验证，PR #36 合并了小时级生产健康工作流的 fail-closed 门禁，PR #38 又固定了现场验收的 Neon provider catalog 合约；这些仓库交付本身仍不代表外部上线完成。Neon 侧已创建新的七天回滚分支，复核角色与 database ACL，设置 Runtime 的 read-only session 默认值，隔离未使用的 `neondb` ambient ACL；维护专用 `hzense_migrator` 因 Neon Tables 用满旧五连接上限而从 limit 5 调整为 10。后者不改变 Runtime 权限或 Web pool 上限 1。2026-09-01 的两组 catalog-only 查询已确认目标 `hzense` ACL 的有效权限与直接授权来源符合五列最小权限合约；[脱敏证据](./production-evidence/2026-09-01-runtime-reader-acl.md)不替代完整生产 preflight。2026-09-03，独立 Runtime 凭据在受保护流程中生成并保存，候选 provider-object 合约以该凭据连续两次通过目标库、`postgres`、`template1`、角色、TLS 与五列权限的[完整生产 preflight](./production-evidence/2026-09-03-runtime-reader-preflight.md)。随后五个 server-only 值仅配置在 Vercel Production；`main@45af242` 的新部署在 `iad1` 达到 `READY` 并接管生产域名，线上 health 返回精确 HTTP 200 / `{"status":"ok"}` / `no-store` 且成功态无 `Retry-After`，真实五列读取、Web pool 上限 1、安全日志及所选十分钟错误窗口均通过[独立生产验收](./production-evidence/2026-09-03-runtime-reader-production-acceptance.md)。`PRODUCTION_DATABASE_HEALTH_ENABLED=true` 已在验收后设置，首次手工运行成功，小时级任务现已启用。PR #40 于 2026-09-04 合并为 `main@0012871`；精确 commit 的 Production 部署与健康合约通过，受控失败运行创建单例 Issue #43，随后正常运行只追加一条恢复评论并关闭同一 Issue。该[告警验收](./production-evidence/2026-09-04-operations-checkpoint.md#production-database-health-alert-acceptance)完成应用层有界 incident/recovery 链，不声称覆盖 Neon PgBouncer client-capacity 或独立 provider 阈值。既有 handling-exposure risk 已构成通常的轮换触发，但 2026-09-04 操作者知情选择本轮延期，本轮没有读取或修改凭据/部署配置；凭据风险不降级且轮换义务仍开放。同日检查确认仓库缺少 pre-normalization ACL dump、backup ID、mutation actor/time，provider backup/PITR 尚未核验；该缺口关闭前禁止再次 normalization。PR #42 在修复早期 CI 的空 ACL 数组 SQLSTATE `22023` 后完整 CI 全绿，squash 合并为 `main@0806e349` 并通过精确 Production 部署/health 兼容性验收；本轮没有生产 ACL baseline 捕获、provider backup 核验或数据库 mutation，因此历史缺口未关闭。PR #41 随后通过最终评审、完整 CI 与精确 commit 的 Production 验收并合并为 `main@83654c48`：完全平局由 ordinal type 与 document ID 构成 total-order，Search `23/23`、Web 定向 `3/3`、线上五结果搜索、数据库 health 与所选路由错误窗口均通过。这完成的是 [FTS-0 contract 与生产兼容性](./production-evidence/2026-09-04-operations-checkpoint.md#fts-0-pr-41-production-acceptance)，不包含 PostgreSQL Migration、持久化、tokenizer/index、回填、查询 parity 或生产 query-path cutover；这些 FTS-1 工作仍未执行。详见[脱敏运维检查点](./production-evidence/2026-09-04-operations-checkpoint.md)。

## 8. Search 与 Vector

当前 V1 仍使用基于已验证 Markdown/Seed 数据的确定性进程内关键词匹配与加权排序。FTS-0
已把六类公开来源的 Search 类型、现有排序和 canonical database projection 抽到可构建的
[`@hzense/search`](../packages/search/) 边界，并用中英文 golden corpus 固定 NFKC、空白分词、
substring AND 匹配、权重与排序语义。投影输入显式绑定发布状态，`documentDate` 可空，并包含
UI 重建所需的 `summary`、`href` 与 `keywords`；稳定 serialization / fingerprint 可用于后续
重建与 parity 门禁。

FTS-1 仓库实现增加 append-only `0003_search_documents_fts.sql`、确定性同步器、加权
`simple` `tsvector` / GIN、参数化数据库查询与 `in-process → shadow → database` 切换模式。
由于 PostgreSQL 默认 tokenizer 不能无损表达中文和任意 literal substring，用户可见 parity
仍由 application-normalized 列上的数据库内 AND/计分公式保证，并复用 JavaScript total-order。
上述为 FTS-1 仓库实现背景；历史生产切换记录见 [进度看板](PROGRESS.md)，本轮整合不重新执行或证明生产状态。新版保留该搜索实现，改为按数据归属和公开版本消费 Outbox，避免旧 Seed 全量同步覆盖数据库内容；Hybrid Search：Keyword + Vector + Entity + Recency + Importance 仍为后续能力。

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

## 11. AI 自主 Signal 生产（目标架构）

三类入口和必需细节统一采用 [AI 自主 Signal 专项设计](AUTONOMOUS_SIGNAL_PIPELINE.md)：来源采集、文件／OCR、批量链接 → 队列 → AI 提取、去重、人物补证、核验与研判 → 发布资格 → Signal 版本与 Outbox → 搜索、页面及派生视图。

Signal 默认 `auto_publish`，合格内容无需逐条人工审核；可显式选择预览或可选审核，但不能绕过事实、人物、时间与隐私规则。机器证据不足自动补查／暂缓。当前 Seed Reader 和旧状态校验到切换前仍生效，不在设计阶段改成自动发表。

保留完整模型配置、能力测试、密钥信封加密、分阶段 Profile、兼容故障切换；来源有游标／ETag／有界回看和受控临时准入；文档首版包括 CSV／XLSX、扫描 PDF、PNG／JPEG OCR。后台 Worker 有租约、取消、预算、恢复点及自动来源更正扫描，所有生成先创建记录再调用模型，费用与结果可检索。

新旧关系变更、人物证据失效、原文撤稿均触发重新核验和派生更新。仅链接失效不是事实撤回依据。当前新发表开关优先于旧任务配置；独立授权的屏蔽／撤回不能被暂停采集的开关误封。

## 12. HZense Daily 自动化（现行兼容，切换后停产）

本节仅保留已有实现契约；不是新增开发路线。新版周度分析直接消费合格 Signal，输出专题洞察版本，不生成新的 Daily／Weekly。新版验收后再明确停用旧定时任务、自动 Draft PR 和相关产品断言，同时保留历史渲染及必要通用门禁。

```text
Signals Today → Cluster by Topic → Rank → Select Important Events
→ Generate Summaries → Detect Emerging Patterns
→ Draft HZense Daily → Human Review → Publish Markdown → Git Commit
```

Continuous Daily 的当前实现采用 `daily-v2` 确定性契约：以 Europe/Berlin 07:00 为每日 cutoff，要求已审核 Signal 同时满足前一天 07:00 至 cutoff 的采集窗口和 `[cutoff − 72 小时, cutoff]` 的事件／公告发生窗口；历史补录不因近期采集而成为当日新闻。生成带证据、双窗口和输入指纹的 `status: draft`，再由 Draft PR 承载人工事实核验、原创研判和发布状态切换。发布校验重算相同选材规则；生成与发布分属只读/最小写权限 Job，机器人不得 mark ready、approve 或 merge。完整运行与回滚手册见 [`CONTINUOUS_DAILY.md`](./CONTINUOUS_DAILY.md)。

## 13. GitHub / Monorepo

现有仓库与待新增边界（注释标明拟议目录，不代表已创建）：

```text
tech-intelligence-hub/
├── apps/web/
├── apps/worker/             # 拟议：后台分步任务执行
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
│   ├── ai/                  # 拟议：模型配置、适配与用量
│   ├── ingestion/           # 拟议：三类入口与安全解析
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
│   ├── SIGNAL_FIRST_REDESIGN.md
│   ├── AUTONOMOUS_SIGNAL_PIPELINE.md
│   ├── TECHNICAL_ARCHITECTURE.md
│   ├── INFORMATION_MODEL.md
│   └── adr/
├── db/
└── .github/workflows/
```

## 14. 部署

以下是目标部署边界，已有环境不因本文自动增加服务、权限或付费资源。Worker／模型／OCR／私有对象存储需独立配置及验收，工程部署与日常内容发表分开。

```text
GitHub
├── Vercel → Next.js → hzense.com
├── Neon → PostgreSQL + pgvector
├── 托管 Worker / 受保护调度 → 分步持久化任务
└── 私有对象存储 → 上传原件与解析产物（不得公开任务附件）
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

新版路由目标：

```text
/             雷达首页
/signals      信号与多维探索
/topics       专题洞察（固定专题与历史洞察版本）
/resources    组织与人物等资源
/search       全站搜索（档案通过显式选项进入）
/admin        受保护管理后台，含 imports / runs / ai / sources / topics
```

旧 `/daily`、`/weekly` 与详情保留只读；`/insights/[id]` 逐条映射或保留，`/radar` 在新首页验收后重定向 `/`。完整迁移表见 [新版设计第 11 节](SIGNAL_FIRST_REDESIGN.md#11-历史迁移与旧功能退场)。

环境域名策略：

```text
Production    https://hzense.com
Preview       Vercel-generated preview URL
Local         http://localhost:3000
```

首次 MVP 部署时完成：Vercel Project 绑定、DNS 记录配置、SSL 验证、`www` 重定向、canonical metadata、sitemap 和 robots 配置。

## 15. CMS 策略

不额外引入独立 CMS；后台编辑与 AI 生产统一调用版本化发布服务，写入数据库业务版本。Markdown 是历史档案或导出，不再与数据库双向同步为两个正文权威。

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

**Signal-first v2 — 当前目标**：三入口自动 Signal + 有据人物／组织 + 雷达首页 + 专题洞察 + 资源活跃度；停止新增 Daily／Weekly。

**后续 Intelligence Engine**：Hybrid Search / RAG、完整图谱、推荐与更深入的趋势研究；不替代本轮 V2-0 至 V2-6 的主路线。

**V4 — Personal Technology Intelligence OS**：Discover → Understand → Connect → Track → Predict。

## 18. 当前开发顺序与历史检查点

当前按 [V2 实施顺序](SIGNAL_FIRST_REDESIGN.md#13-实施顺序与验收) 推进：数据／人物／证据 → 后台与三入口自动生产 → 信号／资源及自动搜索同步 → 雷达 → 专题洞察 → 迁移上线。专项 A–E 是该路线中的技术分解，不是另一份竞争计划。

以下保留旧阶段检查点，不构成本轮现况核验或新增操作授权；尤其恢复演练按操作者后续决定保持未验证，不因文档整合自动重启：

1. ✅ 已完成：PR #30 完成 Topic 全量投影同步器的最终评审、CI 与合并。
2. ✅ 已完成：以经人工验证的新可恢复分支备份应用并验证生产 `0002`，配置独立 `hzense_topic_sync` 与 ACL，完成双 fingerprint dry run、受保护 Apply、独立验证与 no-op 重跑。
3. ✅ 已完成：Runtime Reader 代码、Neon 基础治理、目标 ACL 有界只读复核、独立凭据与完整 preflight，以及 Vercel Production-only 配置、重部署、健康/读取/日志验收和小时级工作流首次手工运行均已完成。
4. ✅ 已记录：既有 handling-exposure risk 已构成通常的轮换触发；操作者知情选择本轮延期，本轮未读取或修改凭据/配置，凭据风险不降级且轮换义务仍开放。
5. 🔴 历史缺口仍阻塞新 normalization：PR #42 已修复空 ACL 数组 SQLSTATE `22023`，其 domain-separated backup-reference SHA-256、绑定 reference 的顶层 baseline fingerprint、`pg_catalog, pg_temp` search path、explicit-empty ACL 保真和 mutation 前双 session-GUC guard 已通过完整 CI、合并及部署兼容性验收。但 provider 备份存在性/恢复能力未核验、生产 baseline 未捕获，也没有生产数据库 mutation；必须先核验 provider backup/PITR、双重采集基线并评审/演练恢复计划。
6. ✅ 已完成本阶段：PR #40 的应用层连接容量/查询取消/总耗时/通用错误安全分类、脱敏池计数与单例 Issue incident/recovery 告警链已在精确 Production commit 上演练通过。
7. ⏳ 未执行：补充 Neon PgBouncer client-capacity 与独立 provider 侧连接、池、数据库阈值监控；PR #40 不覆盖该 provider 边界。
8. ✅ 已完成 FTS-0：PR #41 的 canonical projection、确定性进程内排序器、完全平局 total-order 与稳定 fingerprint 已通过最终评审、CI、合并及精确 Production compatibility 验收。
9. 🚧 FTS-1 仓库开发已完成：独立 Migration、Search Document 同步、tokenizer/index、精确 parity 查询与分阶段切换代码已落地；生产 Migration、回填、ACL、shadow 与 cutover 仍受步骤 5 门禁约束，其后再继续 Hybrid Search 与 Ask HZense / RAG。

截至 2026-09-04，步骤 1–3、6 与 8 已完成并有独立生产证据，步骤 4 已作为明确的风险保留决定记录；步骤 5 的 forward-only 工具已交付但外部恢复证据仍阻塞，步骤 7 待完成，步骤 9 处于“仓库实现完成、生产落地未开始”。小时级有界健康与 Issue 告警链不能替代 ACL 恢复证据、事件触发的凭据轮换或 provider 级指标监控；本地/CI 契约也不能替代 FTS-1 的生产 Migration、回填、shadow parity 和独立 cutover 验收。

---

## v2.0 Signal-first 设计整合

- 产品总纲、Signal-first 详细设计和初版 AI 生产专项契约 `b5a0045` 按职责整合。
- 三入口默认自动发表、完整文档／表格／OCR、AI 配置、增量来源、调度和自动更正为目标能力。
- 新 Signal／洞察版本采用数据库权威与 Outbox；Taxonomy 和历史档案保留原权威。
- 明确人物证据、legacy 兼容、后台与公开读取边界，保留现行权限契约直至新迁移评审。
- 停止新增 Daily／Weekly 的方向进入统一 V2 路线；文档更新不代表工程实施、迁移或生产切换。

## v1.1 域名与模型同步

- 正式生产域名锁定为 **hzense.com**。
- Canonical URL 锁定为 **https://hzense.com**。
- 增加生产、预览和本地环境的域名策略。
- 增加公共路由、`www` 重定向、HTTPS、canonical metadata、sitemap 和 robots 基线。
- 同步 Information Model v2.0.0 的证据契约、十类 Entity 与 Paper / PaperNote 边界。
- 更新开发启动前的下一步工程任务。

> **HZense — Sense what matters in technology.**
