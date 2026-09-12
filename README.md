<p align="center">
  <img src="assets/brand/hzense-logo.png" alt="HZense 标志" width="180" />
</p>

# HZense

> **感知科技中真正重要的变化。**

HZense 是一个科技情报平台，将分散的技术信息整理为结构化、可追溯、可版本化的知识与研判。

- [正式网站：hzense.com](https://hzense.com)
- [Vercel 生产站点](https://tech-intelligence-hub-web.vercel.app/)
- [GitHub 组织](https://github.com/hzense)
- [项目代码仓库](https://github.com/hzense/tech-intelligence-hub)

## 下一阶段：以信号为核心的 v2

[产品设计](docs/DESIGN.md)和 [v2 重构设计](docs/SIGNAL_FIRST_REDESIGN.md)定义了四个主要页面：

- **雷达首页**：展示各领域趋势，以及综合时间、热度和重要程度等因素评出的热点信号 TOP 10。
- **信号**：作为新版的基础信息单元，支持多维筛选与聚合；每条公开信号至少关联一位有证据支持的业界人物。
- **专题洞察**：根据已有信号开展深入分析，默认每周运行，也可由管理员手动触发。
- **资源**：以相关组织为中心，按近期去重事件活跃度排序，并展示关键人物。

[AI 生产技术方案](docs/AUTONOMOUS_SIGNAL_PIPELINE.md)在[初版技术约定 b5a0045](https://github.com/hzense/tech-intelligence-hub/blob/b5a0045f1c7e7591fe04d49409dd5148a10d87aa/docs/AUTONOMOUS_SIGNAL_PIPELINE.md)基础上整合 v2，保留采集、模型配置、调度、预算和自动更正能力。自动采集、文档上传和超链接提交共用默认自动发布的信号流水线，但都必须通过来源证据与人物核验。

后台批量导入设计包含 PDF、DOCX、Markdown、TXT、HTML、CSV、XLSX，以及扫描 PDF、PNG、JPEG 的 OCR 识别，并支持逐项进度、部分成功和失败重试。信号可另行配置为仅预览或必须人工审核；专题洞察的默认发布策略仍需单独确认。

目标流程为：**来源／批量文档／链接 → AI 提取与核验 → 版本化信号 → 雷达、信号、专题洞察和资源**。

新版信号与洞察版本由 PostgreSQL 管理，通过事务发件箱（Outbox）自动更新搜索等派生数据。Git 保留代码、受控分类体系、迁移、历史内容和导出文件。新版切换后停止新增日报与周报，但历史 URL 仍须可读。

以上是已整合的设计基线，不代表功能已实现、数据已迁移或生产已切换。各阶段必须分别开发和验收，进度见 [PROGRESS.md](docs/PROGRESS.md)。下文的旧版 MVP 和历史记录不能当作新版路线图或最新生产检查结果。

## 现有 MVP 流程：保留至新版切换

> **来源 → 信号 → 日报 → 周报 → 专题 → 洞察 → 雷达**

旧版 Daily 工作流从已审核信号中确定性生成候选，校验不可变产物，再通过草稿 PR 交由人工决定发布。[2026-09-04 运维检查点](docs/production-evidence/2026-09-04-operations-checkpoint.md)中的组织权限阻塞是当时状态，不是当前权限诊断。

[持续日报说明](docs/CONTINUOUS_DAILY.md)仍描述切换前的实现约定，但不意味着 v2 必须继续生产日报和周报。

## 现有模块与历史兼容

- **日报（HZense Daily）**：每日科技情报简报。
- **周报（HZense Weekly）**：跨信号的周度综合整理。
- **信号（HZense Signals）**：原子化科技事件与证据。
- **洞察（HZense Insights）**：深入分析和独立研判。
- **专题（HZense Topics）**：持续演进的专题知识。
- **雷达（HZense Radar）**：关注度、趋势、成熟度和战略价值跟踪。
- **资源（HZense Resources）**：人物、企业、机构、技术、产品、模型、数据集、标准／协议、论文和事件。
- **Ask HZense**：规划中的 AI 情报检索与分析能力，尚非已交付功能。

## 技术基础与数据权威

- TypeScript 严格类型检查，Next.js + React 网站。
- 现有编辑内容使用 Markdown／MDX；当前公开信号使用 Seed YAML。
- PostgreSQL + Drizzle ORM 管理物理数据库结构。
- 数据库包含 pgvector 结构支持；安装扩展或声明字段不等于已实现语义检索。
- 已实现标准搜索投影和 FTS-1 数据库搜索，能力说明见[搜索模块](packages/search/README.md)，历史部署证据见[进度记录](docs/PROGRESS.md)。
- 网站部署于 Vercel；v2 导入所需的私有对象存储仍是设计要求，不代表资源已配置。

当前网站从 `data/seed/signals.yaml` 读取公开信号。数据库中存在业务表，不证明这些表已有数据或已成为网站的数据权威。v2 需要显式完成历史导入和读取端切换；历史 Markdown 保持可读，新的信号与专题洞察版本不能同时在 Git 和数据库中双写。

专题的数据权威分层如下：

1. `data/taxonomy/taxonomy.yaml`：受控专题 ID、规范英文名、主父级层次和跨域关系的唯一权威来源。
2. `data/seed/topics.yaml`：经校验的运行子集，拥有当前运行状态。
3. `content/topics/`：本地化专题页面及正文。
4. PostgreSQL `topics`：上述信息的派生投影，不是另一个独立专题权威。

v2 将受控领域分类、AI 提议的主题聚类和数据库管理的洞察版本分开。AI 提议不能直接成为正式分类，纳入 Taxonomy 仍须走受控变更流程。

## 仓库结构

```text
apps/
  web/                     # Next.js 网站
content/                   # 现有编辑内容与历史档案
  daily/
  weekly/
  insights/
  topics/
  briefings/
  papers/
packages/
  content/                 # Zod 模式、内容加载与校验
  database/                # Drizzle 结构、迁移、同步和权限检查
  search/                  # 搜索投影、匹配、排序和数据库查询
  intelligence/            # 智能分析模块预留边界，尚无独立实现
  ui/                      # 共享设计系统预留边界，尚无独立组件包
data/
  schema/                  # 机器可读信息模型
  taxonomy/                # 受控分类体系
  seed/                    # 当前运行数据
  radar/                   # 雷达数据目录预留
db/
  migrations/              # 不可变 SQL 迁移与校验和清单
  roles/                   # 经审核的角色与权限脚本
scripts/                   # 校验与同步入口
docs/
  adr/                     # 架构决策记录
  content-intake/           # 内容来源、审核和导入记录
  production-evidence/     # 脱敏生产验收证据
.github/
  workflows/               # CI、内容与受保护维护工作流
```

## 主要文档

- [产品设计](docs/DESIGN.md)：产品与信息架构。
- [v2 重构设计](docs/SIGNAL_FIRST_REDESIGN.md)：页面约定、迁移和验收。
- [自动信号生产方案](docs/AUTONOMOUS_SIGNAL_PIPELINE.md)：与 v2 整合的 AI 生产技术约定。
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)：模块和技术边界。
- [信息模型](docs/INFORMATION_MODEL.md)：知识与数据模型。
- [开发基础](docs/DEVELOPMENT_FOUNDATION.md)：可执行的工程基础。
- [部署说明](docs/DEPLOYMENT.md)：部署步骤与生产操作约束。
- [全线上维护](docs/ONLINE_MAINTENANCE.md)：受保护的生产维护流程。
- [进度看板](docs/PROGRESS.md)：开发进展、遗留事项和验收链接。
- [工程规范](docs/ENGINEERING_STANDARDS.md)：协作、质量和安全要求。
- [MVP 验收标准](docs/MVP_ACCEPTANCE.md)：旧版 V1 的验收范围。
- [机器可读信息模型](data/schema/information-model.yaml)与[受控分类体系](data/taxonomy/taxonomy.yaml)。

## 历史工程里程碑

本节保留较早的工程检查点。未勾选项和带日期的操作叙述仅表示当时状态，不是当前待办、最新部署审计或新增 v2 前置条件。当前路线与后续证据以[进度看板](docs/PROGRESS.md)为准，本次文档整理不重跑生产检查或恢复演练。

### 工程基础已完成项

- [x] 产品、品牌和域名基线。
- [x] GitHub 组织及公开组织介绍。
- [x] 技术架构、信息模型 v2.0.0 和分类体系。
- [x] pnpm 工作区与 Turborepo 仓库骨架。
- [x] TypeScript 严格模式、ESLint 和 Prettier 基线。
- [x] Vitest 单元测试与 Playwright 浏览器测试基线。
- [x] PostgreSQL／Drizzle 物理结构及包含 pgvector 的迁移基线。
- [x] 可执行的 Zod 文档元数据（Front Matter）校验。
- [x] 专题、实体、关系和历史信号的 Seed 数据。
- [x] 日报、周报、洞察和专题的 Markdown 内容。
- [x] CI 工作流和架构决策记录。
- [x] Next.js 首页、日报、周报、洞察、专题、信号和资源路由。
- [x] 面向已发布内容的基础关键词搜索。

### 旧版 MVP 已完成项

- [x] 在 `apps/web` 初始化网站，首先完成首页和日报。
- [x] 部署到 Vercel，绑定 `hzense.com`，将 `www.hzense.com` 重定向至主域名。
- [x] 增加洞察和专题的列表、详情页。
- [x] 增加周报、信号、资源及基础搜索。
- [x] 发布独立的雷达页面。

### 较早的生产加固清单

- [x] 接入确定性日报候选生成，并验收真实预演产物。
- [ ] 2026-09-04 当时未完成：解决持续日报草稿 PR 的组织权限限制；该旧产品路线已由 v2 信号生产替代。
- [x] 配置托管 PostgreSQL 18／pgvector 0.8.6，执行并独立验证首批生产迁移 `0000`–`0001`。
- [x] 确立 Taxonomy → Seed → Content 权威链，随 PR #30 合并并独立验证完整专题投影同步器。
- [x] 创建并核验新的分支备份，应用并验证生产迁移 `0002_topic_projection.sql`。
- [x] 配置专用 `hzense_topic_sync` 角色及经审核权限，完成首次生产预演、受控写入、独立验证和零变更重跑。
- [x] 随 PR #32–#35 合并运行时只读访问实现与 Neon 服务商约定，独立核验目标库的最小权限。
- [x] 随 PR #36 合并条件不满足即阻断的定时健康检查门禁和触发器校验。
- [x] 完成受保护的运行时凭据配置及预检，仅在 Vercel Production 配置集成、重新部署并独立验收。
- [x] 记录操作者在已知凭据处理风险下推迟本工作周期轮换的决定；未因此读取或修改凭据，轮换风险仍保留。
- [x] 随 PR #42 合并修正后的后续 ACL 基线与会话防护工具，通过隔离 PostgreSQL CI 和部署兼容性检查；该次验收未采集生产 ACL 或修改生产数据库。
- [ ] 当时未完成：补齐历史运行时 ACL 恢复证据；工具合并不等于新备份核验、双次基线采集或恢复方案演练完成。
- [ ] 当时未完成：取得明确授权后限制历史 Hosted Alpha 的公开访问，并验证正式站不受影响。
- [x] 随 PR #40 合并并验收有界数据库健康分类、单一告警事件和恢复关闭流程。
- [ ] 当时未完成：补充 Neon PgBouncer 客户端容量指标及独立的连接池／数据库阈值监控。
- [x] 随 PR #41 合并并验收 FTS-0 标准投影、确定性排序器及完全同分时的稳定排序约定。
- [x] 完成 FTS-1 仓库实现：追加式迁移、确定性持久化与同步、PostgreSQL 查询、影子比对及失败时不自动回退的切换模式。
- 历史上线待办已由后续记录更新：据 [2026-09-11 切换验收](docs/production-evidence/acl/34535908960-1/cutover.md)，当时已完成 FTS-1 数据库模式上线。该次采用明确的恢复未验证风险接受路径，不代表恢复或回滚演练通过。

### 关键历史验收记录

2026-08-31 的生产维护窗口完成 `0002`：当时共 3 条迁移、0 条待执行；62 个专题全部投影、0 个未知行，指纹匹配，零变更重跑成功。新的分支备份和最小权限 `hzense_topic_sync` 角色也完成独立核验。连接信息和原始备份标识不在此记录。

运行时访问实现随后由 PR #32–#35 合并，PR #36 增加定时健康门禁，PR #38 固定经生产验收的 Neon 系统目录约定。准备阶段曾创建七天分支备份、为 `hzense_runtime` 设置 `default_transaction_read_only`，撤销未使用的 `neondb` 上的环境 `PUBLIC` 访问，并在 Neon Tables 用尽原五会话上限后，将仅供维护的 `hzense_migrator` 连接上限从 5 调至 10。

- **2026-09-01**：有界只读系统目录核验确认目标 `hzense` 权限及直接授权来源，详见[脱敏权限矩阵](docs/production-evidence/2026-09-01-runtime-reader-acl.md)。
- **2026-09-03**：独立凭据、目标库及保留库完整预检通过；五项服务端配置仅写入 Vercel Production。部署、公开健康接口、受限读取、安全日志与小时健康工作流首次手动运行通过[生产验收](docs/production-evidence/2026-09-03-runtime-reader-production-acceptance.md)。
- **2026-09-04，PR #40**：合并为 `main@0012871`。精确部署、健康接口、受控失败的告警创建和恢复关闭通过[告警验收](docs/production-evidence/2026-09-04-operations-checkpoint.md#production-database-health-alert-acceptance)。这只覆盖应用健康告警，不代表已有服务商侧容量或独立阈值监控。
- **PR #42**：合并为 `main@0806e349`，修正后的隔离 PostgreSQL CI 与精确部署通过。该次没有生产 ACL 采集、服务商备份／时间点恢复（PITR）核验或数据库修改，不能据此关闭历史恢复证据缺口。
- **PR #41**：合并为 `main@83654c48`，完整 CI、最终评审、精确部署、`/search?q=OpenAI` 的五条结果、数据库健康及选定路由日志窗口通过 [FTS-0 验收](docs/production-evidence/2026-09-04-operations-checkpoint.md#fts-0-pr-41-production-acceptance)。FTS-0 当时没有执行 PostgreSQL 迁移、持久化、分词／索引、回填或生产查询路径切换。
- **后续 FTS-1**：数据库迁移、回填、权限扩展、影子比对和模式切换有独立的[切换记录](docs/production-evidence/acl/34535908960-1/cutover.md)；[2026-09-12 批次记录](docs/production-evidence/2026-09-12-signals-search-sync.md)另行记录内容与索引同步。它们不是实时状态保证，也未验证真实备份恢复能力。

同一历史检查点还记录了凭据轮换延期、组织级日报权限阻塞及旧版 Hosted Alpha 公开访问等边界。不要将当时的观察当作现在的配置，也不要因本次中文化而重新执行任何生产操作。

## 本地开发与基础检查

使用 Node.js 24 和项目固定的 pnpm 11.21.0。若使用 Corepack 管理 pnpm，可先运行下列前两条命令；锁文件已纳入仓库，常规安装应冻结依赖版本。

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @hzense/web dev
```

质量检查在仓库根目录执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm content:validate
pnpm seed:validate
pnpm workflow:validate
```

`pnpm build` 构建整个项目；`pnpm test:e2e` 运行浏览器端到端测试。更多本地说明见[网站 README](apps/web/README.md)。

## 专题数据库投影约定

PostgreSQL 投影受控分类体系中的每一个专题。`topics.id`、`topics.title` 和 `topics.parent_id` 来自 Taxonomy；有 Seed 时使用其 `topics.status`，否则为 `watching`。只有专题存在于 Seed 且状态不是 `archived` 时，`topics.runtime_enabled` 才为 `true`。

专题 Markdown／MDX 的完整性与一致性是写入前的必需门禁，但本地化标题、展示字段和正文不复制到 `topics`。当前物理库没有 `topic_relations` 表，跨域关系仍以 `data/taxonomy/taxonomy.yaml` 为唯一权威。

同步器遵循以下约束：

- 使用事务并复用迁移的咨询锁命名空间，只插入和更新，不删除专题行。数据库出现 Taxonomy 之外的 ID 时立即阻断。
- 默认预演在事务中执行计划内的数据操作与验证，随后回滚，不提交修改。
- 输出权威投影的 `fingerprint`，以及绑定当前受管字段和新增／更新／不变集合的 `planFingerprint`。
- 生产写入要求两项已审核指纹及操作者声明的新建、独立核验备份；必须使用专用最小权限 `hzense_topic_sync`，不能使用迁移角色或网站运行时角色。
- 预检拒绝精确 `public` 允许列表之外的非系统模式访问，以及所有非系统模式中的可执行 `SECURITY DEFINER` 例程；有效表／关系、列、序列权限和对象所有权检查覆盖所有非系统模式。
- 获取与迁移共用键值的事务级排他咨询锁及表锁后、写入之前，重新计算并匹配两项指纹。预演后发生来源或受管数据漂移时拒绝写入。
- 同一维护窗口内的 `db:verify:production` 单独确认物理结构完整性；受限角色预检不能替代完整验证。

首次生产同步记录日期为 2026-08-31，操作细节见[部署说明](docs/DEPLOYMENT.md)。服务商或集群管理员须预先创建 `hzense_topic_sync`，再由明确的数据库／迁移对象所有者执行无凭据的[角色配置 SQL](db/roles/configure_topic_sync.sql)。

该脚本校验固定角色与 `0002`，在事务和与迁移共用的排他咨询锁保护下，撤销 `current_database()` 中环境 `PUBLIC` 的数据库、模式和数据权限，关闭该所有者未来对象的 `PUBLIC` 默认授权，然后仅授予已审核的同步权限。所有依赖这些环境权限或所有者默认授权的非所有者登录都可能受影响，必须另行准备直接授权。完整所有者侧验证、权限配置、受限角色预演和写入须位于同一个冻结 DDL 的维护窗口。

以下是明确区分环境的共享实现入口，不是让开发者从本地直连生产执行的快捷指令；生产使用方式须遵循[全线上维护约定](docs/ONLINE_MAINTENANCE.md)和对应部署流程：

```bash
pnpm db:sync:topics:local:dry-run
pnpm db:sync:topics:local:apply
pnpm db:sync:topics:production:dry-run
pnpm db:sync:topics:production:apply
pnpm db:verify:topics:production
```

生产使用 `HZENSE_TOPIC_SYNC_DATABASE_URL`，并独立配置 `HZENSE_TOPIC_SYNC_EXPECTED_HOST`、`HZENSE_TOPIC_SYNC_EXPECTED_PORT`、`HZENSE_TOPIC_SYNC_EXPECTED_NAME`、`HZENSE_TOPIC_SYNC_EXPECTED_USER`、`HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR` 和 `HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT`。写入还要求 `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT`、`HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT` 和 `HZENSE_TOPIC_SYNC_BACKUP_ID`。

独立投影验证器复用受保护的同步连接及预期身份，但强制 `READ ONLY` 事务，并要求已审核的来源指纹，不会修改数据库。命令行实现只校验备份声明是否存在及格式是否合法，不能证明服务商侧备份存在或可恢复；真实备份核验仍由操作者负责。配置值和凭据不得提交或输出。

本地专题同步也必须使用专用回环测试数据库，预建同名的 `NOINHERIT CONNECTION LIMIT 2` 角色，由该数据库迁移对象的所有者执行已审核权限脚本，再将受限角色连接用于 `HZENSE_TOPIC_SYNC_DATABASE_URL`。普通 `postgres`、所有者或迁移角色连接会被拒绝。详细步骤和数据库范围的 `PUBLIC` 权限影响见[本地专题同步角色](docs/DEPLOYMENT.md#本地-topic-同步角色)。

## 数据库迁移约定

[Drizzle 物理结构](packages/database/src/schema.ts)声明数据库模型。[迁移目录](db/migrations/)中的 `NNNN_name.sql` 按审核顺序执行，其不可变 SHA-256 校验和记录在 [checksums.json](db/migrations/checksums.json)。运行器逐文件开启事务、串行化并发执行，并将校验和记入 `hzense_schema_migrations`。已经应用的迁移不得修改。

2026-08-31 的检查点覆盖截至 `0002_topic_projection.sql` 的三条迁移；`0002` 增加了 `topics.runtime_enabled` 及状态约束。当时的零待执行迁移和首次专题投影，只证明那个时间点的结果。当前迁移清单以校验和文件为准；v2 物理变更必须追加迁移，并同步更新验证器。

本地开发仅接受使用字面回环地址的 PostgreSQL 连接：

```bash
DATABASE_URL=postgresql://...@127.0.0.1:5432/hzense pnpm db:migrate:local
```

生产使用专用非池化端点及受限数据库所有者角色，服务商或数据库管理员须先安装已审核版本的 pgvector。`DATABASE_DIRECT_URL` 必须设置 `sslmode=verify-full`，主机、端口、数据库和用户须独立匹配 `HZENSE_DATABASE_EXPECTED_*`。

以下仅说明受保护生产流程中的底层顺序，不是本地执行授权；实际发起、审批与凭据注入按[全线上维护说明](docs/ONLINE_MAINTENANCE.md)办理：

```bash
pnpm db:preflight:production
# 在此创建并记录服务商快照或 pg_dump 备份，完成相应审核
pnpm db:migrate
pnpm db:verify:production
```

预检只读执行，要求明确审核的直连端点，不接受事务连接池操作模型；在执行 DDL 前校验认证／生效角色、PostgreSQL 主版本、TLS 会话、pgvector 版本、模式权限、目标所有权和迁移历史。生产入口拒绝 Node.js 进程级 TLS 证书校验绕过。

写入后的验证使用只读事务，检查表持久性、所有权、行级安全（RLS）、策略、触发器、完整字段／枚举／键／索引约定、`vector(1536)`、精确迁移校验和及雷达证据约束。

禁止在生产环境或共享、可复用的本地集群运行 `test:migrations`。该测试除了创建、删除临时数据库，还会临时重写集群范围内的 `PUBLIC` 数据库权限；必须使用一次性 PostgreSQL 18 隔离集群，并显式声明 `RUNTIME_READER_TEST_ISOLATED_CLUSTER=1`。

直接由旧 `0000_foundation.sql` 创建的数据库可能没有迁移历史行，标准生产迁移会拒绝自动接管。应急路径需要单独审核系统目录，确认结构确实由仓库中的精确文件创建，并仅向底层本地运行器传入明确的 `HZENSE_DATABASE_BASELINE_CHECKSUM`。来源、信号或雷达中的未知历史行会阻断证据迁移，并报告其 ID，须先显式补齐来源依据。

---

**HZense — 科技情报**

_感知科技中真正重要的变化。_
