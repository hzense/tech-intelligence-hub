# HZense 部署手册

## 目标

GitHub 仓库 `hzense/tech-intelligence-hub` 的 `main` 分支是网站唯一正式源码。Pull Request 生成 Preview Deployment；合并到 `main` 后生成 Production Deployment。旧 Hosted Alpha 仅用于历史对照，在正式域名切换后停止维护。

## 当前部署

- 正式生产域名：https://hzense.com/
- Vercel Production：https://tech-intelligence-hub-web.vercel.app/
- 域名策略：`www.hzense.com` 重定向到 `hzense.com`
- 2026-08-25 线上验收：HTTPS、HTTP → HTTPS、`www` → 根域名、Home、Daily 列表与 Daily 动态路由均正常
- 当前已建立：canonical、sitemap、robots、错误界面、基础安全响应头和桌面/移动端 Playwright 冒烟测试
- 2026-08-29 已创建并验收托管 PostgreSQL 18.6 / pgvector 0.8.6 生产实例、最初 2 个 Migration 与 13 张表
- 2026-08-31 已在新的可恢复分支备份保护下应用 `0002_topic_projection.sql`；独立复核确认 3 个 Migration、0 pending
- 2026-08-31 已配置并验证最小权限 `hzense_topic_sync`，完成生产 dry run、受保护 Apply、独立只读验证与 no-op 重跑；结果为 62 个 Topics、0 个未知行、reviewed fingerprint 匹配和 no-op 0 变更
- Vercel Production 项目仍未配置 Runtime Reader 变量或凭据；`hzense_runtime`、Production-only pooled 连接、重部署与线上健康检查均尚未完成

## Vercel 项目设置

| 设置                                        | 值                                         |
| ------------------------------------------- | ------------------------------------------ |
| Git Repository                              | `hzense/tech-intelligence-hub`             |
| Framework Preset                            | Next.js                                    |
| Root Directory                              | `apps/web`                                 |
| Include source files outside Root Directory | 开启                                       |
| Node.js Version                             | 24.x                                       |
| Install Command                             | 使用 Vercel 自动检测的 pnpm workspace 安装 |
| Build Command                               | `pnpm build`                               |
| Production Branch                           | `main`                                     |

仓库根目录的 `packageManager` 固定为 pnpm 11.21.0，锁文件必须以 frozen 模式通过 CI。`apps/web` 的 `prebuild` 会先构建 `@hzense/content`，因此 Vercel 从 Web workspace 直接构建时不会依赖 Turborepo 的隐式前置产物。

## Monorepo 内容边界

网站构建需要读取 Root Directory 之外的三个目录：

- `content/`：正式 Markdown/MDX 内容
- `data/seed/`：Topic、Entity 和 Signal 引用目录
- `data/taxonomy/`：Topic ID、规范名、primary parent 与跨域关系的正式权威

`apps/web/next.config.ts` 将 output file tracing root 设置为仓库根目录，并为 Home、Daily 列表与 Daily 动态详情路由显式包含以上文件。Vercel 项目仍必须开启 “Include source files outside Root Directory”，否则构建环境在 Next.js 开始追踪之前就可能缺少这些源文件。

## 发布门禁

每次 PR 必须通过：

1. frozen pnpm install
2. lint 与 TypeScript typecheck
3. 从 `apps/web` 直接执行的部署构建
4. 全 workspace 生产构建
5. 单元测试
6. Taxonomy、Seed、内容 Front Matter 与交叉引用校验
7. Topic 全量数据库投影、漂移拒绝、事务回滚与幂等计划测试
8. Seed 与 Radar 数据校验
9. Desktop Chrome 与 Pixel 7 视口的 Playwright 生产冒烟测试

Vercel Preview URL 可作为界面验收证据，但不能替代 GitHub Actions。只有 PR 最终 head 的 CI 与 Preview 均通过后才能合并。

CI 同时支持 GitHub Actions 的 `workflow_dispatch` 手动触发入口。当自动事件未创建运行记录时，应从 Actions 页面选择 CI workflow 和目标分支手动运行；手动运行必须对应 PR 的最终 head commit。

## PostgreSQL 生产迁移

2026-08-29 首次生产迁移已使用受限迁移角色和 direct TLS endpoint 完成，并由独立进程复核。2026-08-31 又在一个新建、可列出并经恢复能力检查的分支备份保护下应用 `0002`；独立只读复核确认 3 个 Migration、0 pending。运维文档只记录备份验证结论，不记录备份标识、连接地址或凭据。Vercel Production 项目仍未配置 Runtime Reader，Web runtime 尚未依赖 PostgreSQL。

后续生产 Migration 仍必须按以下顺序执行；容器 CI 只能证明工具链，不能冒充真实托管实例验收：

1. 从 provider 控制台确认 PostgreSQL 18 的 direct/session endpoint；transaction pooling 不支持迁移器使用的 session advisory lock，不能使用。
2. 由 provider 或管理员安装已审核版本的 pgvector，创建一个 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`、不属于其他角色且拥有专用数据库的迁移角色，并从 `public` 撤销 `PUBLIC CREATE`。
3. 将 direct URL 作为 `DATABASE_DIRECT_URL` 注入受保护的执行环境。URL 必须显式使用端口和 `sslmode=verify-full`；host、port、database、user 另存为独立 `HZENSE_DATABASE_EXPECTED_*` 配置，不能从 URL 自动派生。
4. 执行 `pnpm db:preflight:production`。它只读检查真实 session、TLS、版本、权限、扩展、目标库与 migration history，不打印 URL 或凭据。生产预检始终要求 Node TLS socket 同时满足 `encrypted=true`、证书链已授权、peer certificate 匹配已审核 host，且协商 TLS 1.2/1.3 与有效 cipher；普通 PostgreSQL 还会组合 `pg_stat_ssl` 证据。Neon 等在 PostgreSQL-aware proxy 终止客户端 TLS 的 provider 可能只让该视图看到内部 hop，此时仅使用完整的客户端证据。URL 仍必须通过 `sslmode=verify-full` 与目标 host 校验，不能用该 fallback 接受未验证证书。
5. 在 provider 创建可恢复快照或执行受保护的 `pg_dump -Fc`，记录备份标识并验证可列出/恢复；备份不得上传到 GitHub Actions artifact。
6. 执行 `pnpm db:migrate`，随后执行 `pnpm db:verify:production`。后者只读复核表持久性、所有者、RLS/policy/trigger 状态、catalog、checksum、pgvector typmod 和数据不变量。
7. 再通过单独评审的权限脚本配置独立运行时角色、应用连接和 Web 健康检查；迁移角色不得作为应用凭据。此项尚未执行。

禁止对生产或任何共享 / 可复用的本地 PostgreSQL 运行 `pnpm --filter @hzense/database test:migrations`。该测试套件不仅会创建、终止连接并删除多个临时数据库；Runtime Reader fixture 还会临时改写每个其他可连接数据库的 `PUBLIC CONNECT` / `CREATE` / `TEMPORARY` ACL，再按捕获值恢复。它只能指向一次性、可丢弃、隔离的 PostgreSQL 18 cluster。除显式管理员 URL 外，还必须设置 `RUNTIME_READER_TEST_ISOLATED_CLUSTER=1` 作为危险 fixture 的操作确认门禁；该变量绝不能用于生产或共享环境。

## PostgreSQL Topic 投影同步

`0002_topic_projection.sql` 先为既有 `topics` 表增加 `runtime_enabled` 及状态约束；该 DDL 必须通过标准生产 Migration 流程执行。Schema 就绪后的 Topic 同步属于可重复的数据投影 DML，不得把 Migration 通过当作数据同步证据。2026-08-31 的生产证据分别覆盖 DDL 与数据投影：独立复核确认 3 个 Migration、0 pending，并在后续同步中验证完整 Topic 行集。

投影覆盖完整 Taxonomy：

- `id`、英文 `title`、`parent_id` 来自 `data/taxonomy/taxonomy.yaml`。
- Seed 中存在的 Topic 使用 Seed `status`；Taxonomy-only Topic 使用 `watching`。
- `runtime_enabled` 仅当 Topic 存在于 Seed 且 Seed 状态不是 `archived` 时为 `true`。
- Topic Content 必须通过完整写前门禁，但本地化标题、展示字段和正文不写入数据库。
- `cross_domain_relations` 本阶段仍只存在于 Taxonomy YAML；同步器不创建隐式数据库关系。

同步器默认执行不持久化的 dry run：在一个事务中计算 source fingerprint 与 plan fingerprint，执行拟议 DML 与写后校验，随后强制回滚。Source fingerprint 只绑定权威投影；plan fingerprint 还绑定当前数据库托管字段与 insert/update/no-op 行集。Apply 才提交同一事务；两种模式均复用 Migration advisory lock，只允许 insert/update。Apply 在取得 advisory lock 与 `topics` table lock 后、任何写入前重新计算并精确匹配两个 fingerprint。发现 PostgreSQL 中存在 Taxonomy 之外的 Topic ID，或 dry run 后输入/数据库漂移导致计划改变时，立即 fail closed；绝不 delete、truncate、自动 archived 或接管未知数据。

首次生产同步必须严格按以下顺序执行：

1. 固定已合并的 `main` commit，完成 Taxonomy → Seed → Content 校验，并记录该输入生成的 source fingerprint。
2. 使用现有受限 Migrator 执行标准 production preflight，创建并由操作者验证一个新的 provider 快照或受保护 `pg_dump -Fc`，确认它可列出且可恢复，并记录 backup ID，然后执行 `pnpm db:migrate` 与 `pnpm db:verify:production`，确认 `0002` 已登记且 `runtime_enabled` / 约束符合完整 Schema。2026-08-29 的 `pre-migration` 快照不能冒充本次备份。
3. 由 provider / 集群管理员预先创建固定角色 `hzense_topic_sync` 并单独设置凭据；其属性必须为 `LOGIN NOINHERIT CONNECTION LIMIT 2 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`，不得继承或切换到其他角色。随后以当前数据库及 Migration 对象的 owner（生产为 Migrator，而不是同步角色）执行已评审的 [`db/roles/configure_topic_sync.sql`](../db/roles/configure_topic_sync.sql)。脚本不创建角色、不包含密码或 URL；它在一个事务中复用 Migration advisory lock，安全引用 `current_database()`，验证 `0002`、owner 和固定角色属性，先清除环境 ACL，再仅授予目标数据库 `CONNECT`、`public` Schema 与 `topic_status` Type 的 `USAGE`、`hzense_schema_migrations` 的 `SELECT`，以及 `topics` 的 `SELECT`、`INSERT`、`UPDATE`。不授予数据库 `CREATE` / `TEMPORARY`、Schema `CREATE`、Sequence 权限、未来对象默认权限、`DELETE`、`TRUNCATE`、DDL 或其他领域表权限。同步预检必须拒绝该角色访问 `public` 之外任何非系统 Schema，并拒绝它执行任何非系统 Schema（包括 `public`）中的 `SECURITY DEFINER` routine；有效 relation/table 权限、列级权限、Sequence 权限和 Schema / Type / Relation / Routine / Extension ownership 检查必须覆盖所有非系统 Schema，而不是只检查 `public`。
4. 将 `HZENSE_TOPIC_SYNC_DATABASE_URL` 以及独立的 `HZENSE_TOPIC_SYNC_EXPECTED_HOST`、`HZENSE_TOPIC_SYNC_EXPECTED_PORT`、`HZENSE_TOPIC_SYNC_EXPECTED_NAME`、`HZENSE_TOPIC_SYNC_EXPECTED_USER`、`HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR`、`HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT` 注入受保护的手工执行环境；不得使用 `hzense_migrator`、默认 owner、未来 Web Runtime 凭据或公开 CI 日志。
5. 对真实 direct/session TLS endpoint 执行 `pnpm db:sync:topics:production:dry-run`，核对有效角色、连接上限、Schema / Migration 基线、当前 Topic ID、完整预期行数、insert/update/no-op 数量、source `fingerprint` 与 `planFingerprint`。存在未知数据库 ID 时停止。
6. 将 dry run 的精确 source fingerprint 写入 `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT`，将精确 plan fingerprint 写入 `HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT`，并把步骤 2 中已经人工验证的新 backup ID 作为声明值写入 `HZENSE_TOPIC_SYNC_BACKUP_ID`；随后执行 `pnpm db:sync:topics:production:apply`。Apply 必须在持有 advisory lock 与 table lock 的同一事务内、写入前重新计算并同时匹配 source 与 plan guard。任何缺失、不合格式或不匹配都必须在 DML 前失败。
7. Apply 后由独立只读进程执行 `pnpm db:verify:topics:production`，在 `BEGIN READ ONLY` 事务中验证完整 62 条 Taxonomy 行集、`id/title/parent_id/status/runtime_enabled`、未知行数量为零及 `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT` 对应关系。该命令只执行预检与 `SELECT`，不接受命令行参数，也不包含任何 DML。
8. 在同一 `main` commit 上再次执行 `pnpm db:sync:topics:production:dry-run`，结果必须为 no-op，才能记录本次生产同步完成。
9. 在受保护的运维记录中登记 commit、执行时间、角色、实际 backup ID、两个 fingerprint、insert/update 数量、验证结果和 no-op 证据；不得记录 URL、密码或 Token。CLI 日志只以 `productionBackupDeclarationProvided: true` 表示收到了声明，不打印 backup ID，也不代表它已调用 provider 验证备份存在或可恢复。

步骤 2 的完整 `db:verify:production`、步骤 3 的角色 ACL 配置，以及后续 dry run / Apply 必须在同一维护窗口内完成；从完整验证开始直至 Apply 与独立复核结束，冻结 owner / Migrator DDL。`db:verify:production` 是 owner 视角的完整物理 Schema 验证，Topic sync preflight 是受限角色视角的 scoped ACL / 写入基线验证，后者不能替代前者。

权限脚本会在**当前数据库范围**从 `PUBLIC` 撤销数据库 `CONNECT` / `CREATE` / `TEMPORARY`、`public` Schema 权限以及现有业务表、列和 Sequence 的 ACL；同时关闭当前 Migration owner 在该数据库所有 Schema 的全局未来 Table、Sequence、Function 与 Type 公开默认权限，并清除 `public` 上可能叠加的同类默认授权。目标数据库 owner 的固有权限不受影响。该变更会让所有原先依赖 `PUBLIC` 或该 owner 全局默认授权的非 owner 登录失去访问，必须事先盘点并以单独评审的直接授权恢复其他必要角色。当前生产 Web runtime 尚未连接数据库，因此首次配置不得顺带创建或授权 Web 角色。生产可用迁移 owner 的受保护 direct URL 从仓库根目录执行（不要把 URL 展开到日志）：

```bash
psql -X "$DATABASE_DIRECT_URL" -v ON_ERROR_STOP=1 \
  -f db/roles/configure_topic_sync.sql
```

在 Neon SQL Editor 等不支持 `\i` 的 Web 界面，先确认 `SELECT current_database(), session_user, current_user;` 与受保护配置完全一致，再粘贴并整体执行该 SQL 文件。脚本会拒绝非数据库 / Migration owner、`SET ROLE` 会话、缺少 `0002`、属性不符或已有跨 Schema 权限的同步角色，并在任一 postcondition 不符时整体回滚；执行后仍必须使用同步角色的 direct URL 运行 production dry run，使 scoped preflight 独立复核实际 session。

`HZENSE_TOPIC_SYNC_BACKUP_ID` 是操作者对“本次新备份已经在 provider 侧独立验证”的声明值，不是 provider 验证 API。CLI 只校验它存在且符合允许的标识格式；备份创建、可列出性与可恢复性仍是步骤 2 的外部人工门禁。

### 本地 Topic 同步角色

本地命令也执行与生产相同的受限角色 preflight；普通 `postgres`、数据库 owner 或 Migrator URL 会因为 owner 身份、`INHERIT`、无限连接或 ACL 过宽而被拒绝。请只在专用 loopback 开发数据库中完成 Migration，然后由本地集群管理员用交互式密码提示创建同名角色（角色是 cluster-wide；已存在时先核验而不要重复创建）：

```bash
createuser --host=127.0.0.1 --port=5432 --username=postgres \
  --login --no-inherit --no-superuser --no-createdb --no-createrole \
  --no-replication --no-bypassrls --connection-limit=2 --pwprompt \
  hzense_topic_sync
```

再以该本地数据库及 Migration 对象的 owner 执行同一权限脚本，并把同步角色的 loopback URL 放入未提交的环境变量。脚本撤销该数据库的 `PUBLIC CONNECT/TEMPORARY`，所以本地也应使用独立数据库；owner 仍可连接，其他需要访问的角色必须获得单独直接授权。

```bash
psql -X "$LOCAL_MIGRATION_OWNER_URL" -v ON_ERROR_STOP=1 \
  -f db/roles/configure_topic_sync.sql
export HZENSE_TOPIC_SYNC_DATABASE_URL='postgresql://hzense_topic_sync:...@127.0.0.1:5432/hzense'
export HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR=18
export HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT=2
pnpm db:sync:topics:local:dry-run
```

上述首次生产流程已于 2026-08-31 完整执行并独立复核：新建的分支备份确认可恢复，`0002` 已应用，Migration 历史为 3 个且 0 pending，`hzense_topic_sync` 固定属性与最小 ACL 已验证，生产 dry run 与受保护 Apply 使用 reviewed fingerprint，独立只读 verifier 确认 62 个 Topics 与 0 个未知行，最后一次 dry run 为 0 变更 no-op。现场记录保留实际 backup ID、连接目标与凭据；这些敏感值不得写入仓库或日志。

## PostgreSQL Runtime Reader

Runtime Reader 与 Migrator、Topic Sync Writer 是三个不可复用的权限边界。固定登录角色为 `hzense_runtime`，由 provider / 集群管理员预先创建并设置 `LOGIN NOINHERIT CONNECTION LIMIT 20 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`，以及 session 默认值 `default_transaction_read_only = on`。普通受限数据库 owner 不得替另一个角色修改该 session 默认值；[`configure_runtime_reader.sql`](../db/roles/configure_runtime_reader.sql) 与 [`runtime-reader-preflight.mjs`](../packages/database/src/runtime-reader-preflight.mjs) 只验证并 fail closed，不越权设置。

本地与非生产环境仍要求 `hzense_runtime` 没有任何 incoming / outgoing role membership。Neon Production 只允许唯一一条 provider control-plane 管理关系：`cloud_admin` 将 `hzense_runtime` 授予 `neondb_owner`，且 `ADMIN = true`、`INHERIT = false`、`SET = false`。该边不让 `neondb_owner` 继承或 `SET ROLE` 取得 Runtime 权限，也不向 Runtime 反向授予 owner 能力；`ADMIN = true` 仍允许 provider branch owner 转授该角色，这是被显式接受并在每次生产 preflight 中重新审计的 provider-governance residual。任何第二条边、反向边、不同 member / granted role / grantor，或任一 option 漂移都必须 fail closed。

数据库 owner 运行经过评审的 Runtime Reader ACL 配置后，该角色在目标数据库内只允许：

- 连接目标数据库；
- 使用 `public` Schema 与应用 enum type `topic_status`；
- 对 `topics(id, title, parent_id, status, runtime_enabled)` 五列执行 `SELECT`。

不得授予 `metadata`、Migration 历史、其他 HZense 表或列的读取权限，也不得授予 HZense relation 写入、应用 DDL、`TEMPORARY`、Sequence、应用 Function、数据库 / Migration owner 的未来对象 `PUBLIC` 默认权限、任何 principal 直接给 Runtime 的未来对象默认授权、应用对象 ownership 或 grant option；除 `topic_status` 外的应用 enum type `USAGE` 也会从 `PUBLIC` 和该角色撤销。其他能够创建应用对象的 principal 仍属于外部 DDL 治理与冻结范围；preflight 会拒绝其最终产生的 Runtime 有效访问，但脚本不会重写所有 principal 的 `PUBLIC` 默认权限。唯一保留的 routine 例外是经过 extension dependency 证明的 `SECURITY INVOKER` pgvector functions：普通合约要求 routine owner 与 extension owner 一致且该 owner 既不是 Runtime 也不是数据库 owner；Neon Production 另接受精确 provider 合约 `vector 0.8.6`、routine owner `cloud_admin`、extension owner `neondb_owner`。现场验证 118 个 routines 全部位于 `public` Schema 且匹配，且无 `SECURITY DEFINER`、grant option 或 Runtime direct ACL；production runner 只在先验证 Neon pooler/TLS 后启用该例外。routine 审计覆盖所有非系统 Schema，不依赖 Schema `USAGE`，以阻止 private function 经 public operator/cast 间接调用。任何版本、owner、dependency、security mode 或 ACL 漂移，任何非 pgvector 应用 routine、PostgreSQL table-inheritance 边或可绕过应用表 ACL 的执行路径都会让 preflight 失败。

Type denylist 的声明仅覆盖非系统应用 enum；provider-owned extension Types 与其他非-enum Types 不在该声明内，脚本不声称移除了它们的 ambient PostgreSQL `USAGE`。它们不扩展固定 Web 投影。

PostgreSQL 角色和数据库 ACL 属于集群级边界。每个普通的非目标且 `datallowconn = true` 数据库都必须让 `hzense_runtime` 的有效 `CONNECT`、`CREATE` 与 `TEMPORARY` 全部为 false；目标数据库 owner 脚本和受限角色 preflight 都会枚举并 fail closed，但不会越权修改其他数据库。权限是可叠加的，仅对 `hzense_runtime` 执行直接 `REVOKE` 不能抵消 `PUBLIC` 权限。provider / 集群管理员必须在盘点现有访问者后撤销相应 ambient 权限，并为仍需连接的角色保留经过评审的直接授权。

Neon 的 `postgres` 与 `template1` 由 provider 角色 `cloud_admin` 所有，受限项目 owner 不能安全重写。仓库只把这两个数据库的**精确 provider 默认状态**列为窄例外：固定 owner、模板标志、connection limit、default-vs-explicit ACL 形态、无 grant option、无直接 Runtime ACL、无 `CREATE`，并分别保持 `postgres` 的默认 `PUBLIC CONNECT` / `TEMPORARY` 与 `template1` 的默认 `PUBLIC CONNECT`。`template0` 必须继续不可连接；`neondb` 或任何其他普通数据库绝不进入例外。生产 preflight 不会只凭数据库名放行，而是用 Runtime 凭据逐库连接，复核身份、session/global read-only、TLS、数据库合约、login event trigger，以及非系统对象的 access / ownership；任一字段或对象访问漂移都会阻断上线。以后新建任何可连接数据库也会重新触发门禁。

该边界是 **HZense 应用 Schema 与固定 Web 查询的最小权限**，不是 PostgreSQL 数据库全局、不可绕过的绝对只读证明。`default_transaction_read_only` 是可由登录会话覆盖的默认值，而 PostgreSQL `pg_catalog` 的 Large Object 等系统接口可能允许普通登录创建其拥有的数据库对象；Neon 的受限数据库 owner 未必有权修改这些系统函数的集群级 `PUBLIC EXECUTE`。因此 Runtime 凭据仍按高敏感凭据处理。若未来验收标准要求数据库全局不可写，必须新增 provider 强制的只读副本，或由集群管理员收紧并独立验证相关系统函数 ACL，不能只依赖本脚本。

Web 连接只使用 `HZENSE_RUNTIME_DATABASE_URL`，并且只配置在 Vercel Production。该 URL 必须是显式端口、`sslmode=verify-full`、`channel_binding=prefer` 的官方 Neon pooled endpoint（host 以 `.neon.tech` 结尾且含 pooler 标识）；Web 驱动还必须显式设置 `enableChannelBinding: true`，并拒绝 `NODE_TLS_REJECT_UNAUTHORIZED=0`。稳定版 `pg@8.23` 的该选项是 prefer 语义：服务端提供 `SCRAM-SHA-256-PLUS` 时使用 channel binding，但不声称 fail-closed 的 require；必须等上游稳定版原生支持并通过完整认证流测试后才能升级为 require。请求时还要分别匹配 `HZENSE_RUNTIME_EXPECTED_HOST`、`HZENSE_RUNTIME_EXPECTED_PORT`、`HZENSE_RUNTIME_EXPECTED_NAME` 与固定用户 `HZENSE_RUNTIME_EXPECTED_USER=hzense_runtime`。`HZENSE_RUNTIME_EXPECTED_POSTGRES_MAJOR` 与 `HZENSE_RUNTIME_EXPECTED_CONNECTION_LIMIT` 属于部署前数据库 preflight 合约，不由每个 Web 请求重复查询。真实值不得进入仓库、Preview、CI 或客户端 bundle。

Web 只在 `VERCEL_ENV=production` 的请求时延迟创建 server-only `pg.Pool`，进程池上限为 1；构建、Preview 和非生产请求不初始化连接池，并统一 fail closed。业务查询使用 `FROM ONLY public.topics` 固定只返回上述五列，只读取 `runtime_enabled = true` 的行，按 `id` 排序，使用参数化 `LIMIT`，且上限为 50；SQL 配置和 preflight 还会拒绝非系统 table-inheritance 边。

健康检查固定为动态 Node.js 路由 `/api/health/database`，最长执行 10 秒，为 3.5 秒连接超时与 3 秒客户端查询超时保留平台收尾余量；不得把 `statement_timeout` 或其他 Neon PgBouncer 不支持的参数放进 startup packet。项目级 [`apps/web/vercel.json`](../apps/web/vercel.json) 把该 Function 固定到 `iad1`，不依赖已经弃用的 route-level region export。成功只返回 HTTP 200 与 `{"status":"ok"}`；失败只返回 HTTP 503 与 `{"status":"unavailable"}`，并设置 `Retry-After: 5`。两种响应都必须使用 `Cache-Control: no-store`。结构化日志仅允许事件、结果、耗时、request ID、安全错误码、SQLSTATE 与连接池 total / idle / waiting 计数；禁止记录 URL、host、database、user、SQL、参数或原始异常。

Runtime Reader 仓库边界已通过 PR #32–#35 合并并由 CI 验证。Neon 基础治理已有现场证据：已创建一份新的七天分支备份并盘点角色/数据库 ACL；`hzense_runtime` 已设置 `default_transaction_read_only = on`；未使用的 `neondb` 已撤销 ambient `PUBLIC CONNECT` / `CREATE` / `TEMPORARY`。2026-09-01 的两组 catalog-only `SELECT` 又独立确认目标 `hzense` ACL 的有效权限与直接授权来源均匹配五列最小权限合约；[脱敏矩阵与查询/结果指纹](./production-evidence/2026-09-01-runtime-reader-acl.md)不包含连接信息。这些动作仍不等于 Runtime Reader 已上线：独立 Runtime 凭据、受保护生产 preflight、Vercel Production 变量、重部署、线上 health、真实五列查询和日志验证尚未完成。PR #36 合并后，`production-health.yml` 的小时级调度由仓库变量 `PRODUCTION_DATABASE_HEALTH_ENABLED` 控制；首次验收前不得设为 `true`，但维护窗口可以手工触发。

`hzense_migrator` 是维护角色而不是 Web Runtime。Neon Tables 曾用满其旧 `CONNECTION LIMIT 5` 并触发 `53300`，因此本次将运维上限调整为 10，为 provider Web 工具和一次受控维护保留余量。该决定不向 Runtime Reader 授权、不改变 `hzense_runtime` 的 limit 20，也不改变 Web 进程池上限 1；如再次出现容量错误，应先检查 `pg_stat_activity`、连接来源与池行为，而不是继续无界提高上限。

Runtime ACL 脚本包含目标数据库范围的 destructive ACL normalization：它撤销 `PUBLIC` 的数据库 `CONNECT` / `CREATE` / `TEMPORARY`、`public` Schema、现有应用 Table / Column / Sequence 权限，并从所有非系统应用 enum types 撤销 `PUBLIC USAGE`；随后只给 `hzense_runtime` 恢复本文 allowlist。额外的跨数据库隔离也可能要求集群管理员撤销其他数据库的 `PUBLIC CONNECT` / `CREATE` / `TEMPORARY`。所有依赖 ambient `PUBLIC` 权限的非 owner 登录都可能受影响。执行前必须创建并独立验证新的 provider 分支备份，盘点整个 cluster 中每个可连接数据库的现有非 owner 有效权限并记录可回滚 ACL，为仍需工作的角色准备经过评审的直接授权；不得假设前一次 Topic 备份足以代表当前状态，也不得把目标数据库备份当作其他数据库 ACL 的回滚证据。

首次 Runtime Reader 上线必须严格按以下顺序执行。状态以 2026-09-01 的现场证据为准；目标 ACL 已完成有界只读复核，但生产接入与验收仍未完成：

1. 🟡 `hzense_runtime` 固定属性、上述唯一 Neon control-plane membership 形态与 `default_transaction_read_only = on` 已盘点；仍须在受保护流程中生成/轮换独立 Runtime 凭据，且不得在 SQL history、终端输出或仓库中暴露。
2. 🟡 新的七天 provider 分支备份与 cluster 角色/ACL 盘点已完成；本次只读复核没有重新审计受保护的 pre-change ACL 恢复材料。
3. 🟡 普通 `neondb` 的 ambient 访问已隔离；`postgres` / `template1` 只允许上述精确 Neon 保留库合约，仍须由生产 preflight 使用 Runtime 身份逐库深检。无法匹配或发现其他可连接数据库时，本次上线阻断。
4. ✅ 目标 ACL 当前状态已由两组独立、只读的 catalog 查询确认：数据库/Schema/type 直接 allowlist、五列 Column `SELECT`、grant option 与 `PUBLIC`/额外权限 denylist 均匹配，且没有数据库写入。该证据证明当前 ACL 状态，不声称恢复历史 mutation transaction 的时间或操作者；完整生产 preflight 仍属于步骤 5。

   经评审的配置脚本入口保留如下，只有新的受控维护窗口才允许再次执行：

   ```bash
   psql -X "$DATABASE_DIRECT_URL" -v ON_ERROR_STOP=1 \
     -f db/roles/configure_runtime_reader.sql
   ```

5. ⏳ 使用 `hzense_runtime` 的受保护 pooled 连接运行仓库提供的独立生产 preflight；它从 `HZENSE_RUNTIME_*` 映射 URL、expected host / port / database / user，以及固定的 PostgreSQL major 18 / connection limit 20，并以 `profile: "production"` 复核 TLS、角色属性、目标 ACL、session 只读默认值及跨数据库隔离，同时连接并深检精确允许的 Neon 保留库。不得把环境变量展开到命令行或日志。

   ```bash
   pnpm db:preflight:runtime:production
   ```

6. ⏳ 仅在 Vercel Production 配置 Web 请求时需要的 URL、expected host / port / database / user；PostgreSQL major 与 connection limit 留在部署前 preflight 环境，不注入 Preview / CI，也不要求 Web 每请求查询 catalog。
7. ⏳ 触发新的 Production Deployment，等待对应已合并 commit 达到 `READY`；构建本身不得建立数据库连接。
8. ⏳ 独立冷/热请求 `/api/health/database`，验证 HTTP 200、正文精确为 `{"status":"ok"}`、`Cache-Control` 包含 `no-store` 且无失败态 `Retry-After`，再验证真实五列查询、池上限和安全日志。任何 503、host/database/user/SQL/参数/原始错误/凭据泄漏，或缺少对应运行时日志证据都视为失败。
9. ⏳ 只有步骤 8 全部通过后，才将 GitHub 仓库变量 `PRODUCTION_DATABASE_HEALTH_ENABLED` 设置为 `true`，启用 `production-health.yml` 的小时级检查；首次启用后立即手工运行一次并确认成功。该变量不是凭据，不得替代 Vercel Production 的五个 Runtime 配置值。

回滚材料必须先于 destructive ACL normalization 建立。若步骤 4–5 失败，停止发布，不向 Vercel 写入变量；按受保护的 pre-change ACL 记录恢复授权，必要时从本次七天 provider 分支恢复。若步骤 6–8 失败，保持或恢复 `PRODUCTION_DATABASE_HEALTH_ENABLED=false`，先移除五个 Runtime Reader Production 变量并重部署上一已知健康 commit，再轮换 Runtime 凭据；若放弃本次接入，再恢复目标 ACL。七天备份到期前必须完成验收或明确执行恢复/重新备份，不能把已过期分支当作回滚证据。

## 首次上线顺序

1. ✅ 已完成：导入 GitHub 仓库并按上表创建 Vercel 项目。
2. ✅ 已完成：用 PR 的 Preview Deployment 验证 Home、Daily 列表和至少一篇 Daily 详情。
3. ✅ 已完成：合并后验证 Production Deployment。
4. ✅ 已完成：添加 `hzense.com`，完成 DNS 与 SSL 验证。
5. ✅ 已完成：添加 `www.hzense.com` 并重定向到根域名。
6. ✅ 已完成：建立 canonical、sitemap、robots、错误界面与基础安全响应头。
7. 🚧 进行中：验证生产日志与基础监控后，停止维护旧 Hosted Alpha。
8. ✅ 已完成：创建 Neon PostgreSQL 18 / pgvector 0.8.6 实例与受限迁移角色，使用真实 direct TLS endpoint 完成 preflight → snapshot → migrate → verify；随后解除 Vercel Production 项目连接并确认集成注入的数据库变量均不存在。
9. ✅ 已完成：以新分支备份应用并验证 `0002`，配置 `hzense_topic_sync`，完成 Topic 生产 dry run → Apply → 独立验证 → no-op 重跑。
10. 🚧 进行中：已完成新七天回滚分支、Runtime read-only 默认值、`neondb` 隔离、Migrator 容量治理与目标 ACL 有界只读复核；独立 Runtime 凭据、保留库深检、Vercel Production 注入、重部署及健康/读取/日志验收仍待完成。
