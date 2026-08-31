# HZense 部署手册

## 目标

GitHub 仓库 `hzense/tech-intelligence-hub` 的 `main` 分支是网站唯一正式源码。Pull Request 生成 Preview Deployment；合并到 `main` 后生成 Production Deployment。旧 Hosted Alpha 仅用于历史对照，在正式域名切换后停止维护。

## 当前部署

- 正式生产域名：https://hzense.com/
- Vercel Production：https://tech-intelligence-hub-web.vercel.app/
- 域名策略：`www.hzense.com` 重定向到 `hzense.com`
- 2026-08-25 线上验收：HTTPS、HTTP → HTTPS、`www` → 根域名、Home、Daily 列表与 Daily 动态路由均正常
- 当前已建立：canonical、sitemap、robots、错误界面、基础安全响应头和桌面/移动端 Playwright 冒烟测试
- 2026-08-29 已通过 Vercel Marketplace 创建 Neon Free 生产实例 `hzense-production-postgres`；实时验收为 AWS `us-east-1`、PostgreSQL 18.6、pgvector 0.8.6，2 个生产 Migration、13 张表与 0 个待执行 Migration 均已验证
- Vercel Production 项目连接已解除，集成注入的数据库变量均不存在；Neon 实例与迁移前快照保留，Web runtime 当前没有数据库凭据、角色或授权
- Topic 全量投影同步器与 `0002_topic_projection.sql` 已在仓库实现；截至 2026-08-30，生产仍只有 2 个已执行 Migration，`0002` 与 Topic 数据同步均为 `not_executed`，且尚未创建 `hzense_topic_sync`、新备份或任何生产 dry run / Apply / 数据验证

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

2026-08-29 首次生产迁移已使用受限迁移角色和 direct TLS endpoint 完成，并由独立进程复核。迁移前未设置自动过期时间的手动快照 `pre-migration-2026-08-29T20:46:11Z` 仍保留；Vercel Production 项目连接已解除，集成注入的数据库变量均不存在，Neon 资源本身未删除。GitHub `Production` environment 未配置迁移 secret，Web runtime 也尚未依赖 PostgreSQL，且没有数据库凭据、角色或授权。

后续生产 Migration 仍必须按以下顺序执行；容器 CI 只能证明工具链，不能冒充真实托管实例验收：

1. 从 provider 控制台确认 PostgreSQL 18 的 direct/session endpoint；transaction pooling 不支持迁移器使用的 session advisory lock，不能使用。
2. 由 provider 或管理员安装已审核版本的 pgvector，创建一个 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`、不属于其他角色且拥有专用数据库的迁移角色，并从 `public` 撤销 `PUBLIC CREATE`。
3. 将 direct URL 作为 `DATABASE_DIRECT_URL` 注入受保护的执行环境。URL 必须显式使用端口和 `sslmode=verify-full`；host、port、database、user 另存为独立 `HZENSE_DATABASE_EXPECTED_*` 配置，不能从 URL 自动派生。
4. 执行 `pnpm db:preflight:production`。它只读检查真实 session、TLS、版本、权限、扩展、目标库与 migration history，不打印 URL 或凭据。生产预检始终要求 Node TLS socket 同时满足 `encrypted=true`、证书链已授权、peer certificate 匹配已审核 host，且协商 TLS 1.2/1.3 与有效 cipher；普通 PostgreSQL 还会组合 `pg_stat_ssl` 证据。Neon 等在 PostgreSQL-aware proxy 终止客户端 TLS 的 provider 可能只让该视图看到内部 hop，此时仅使用完整的客户端证据。URL 仍必须通过 `sslmode=verify-full` 与目标 host 校验，不能用该 fallback 接受未验证证书。
5. 在 provider 创建可恢复快照或执行受保护的 `pg_dump -Fc`，记录备份标识并验证可列出/恢复；备份不得上传到 GitHub Actions artifact。
6. 执行 `pnpm db:migrate`，随后执行 `pnpm db:verify:production`。后者只读复核表持久性、所有者、RLS/policy/trigger 状态、catalog、checksum、pgvector typmod 和数据不变量。
7. 再通过单独评审的权限脚本配置独立运行时角色、应用连接和 Web 健康检查；迁移角色不得作为应用凭据。此项尚未执行。

禁止对生产运行 `pnpm --filter @hzense/database test:migrations`。该测试套件会创建、终止连接并删除多个临时数据库，只能使用显式的本地管理员 URL。

## PostgreSQL Topic 投影同步

`0002_topic_projection.sql` 先为既有 `topics` 表增加 `runtime_enabled` 及状态约束；该 DDL 必须通过标准生产 Migration 流程执行。Schema 就绪后的 Topic 同步属于可重复的数据投影 DML，不得把 Migration 通过或历史“2 个 Migration、13 张表、0 pending”验收当作数据同步证据。仓库目标 Schema 现有 3 个 Migration；最后一次生产证据仍只有 2 个，`0002` 尚未执行。

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

截至 2026-08-30，上述生产步骤均未执行：`0002` 尚未应用，`hzense_topic_sync` 尚未创建，受保护同步配置尚未注入，没有新的备份、生产 dry run、Apply、独立数据验证或 no-op 重跑。生产 `topics` 当前行数和内容也没有在本阶段现场核验，不能根据仓库数据推断。

## 首次上线顺序

1. ✅ 已完成：导入 GitHub 仓库并按上表创建 Vercel 项目。
2. ✅ 已完成：用 PR 的 Preview Deployment 验证 Home、Daily 列表和至少一篇 Daily 详情。
3. ✅ 已完成：合并后验证 Production Deployment。
4. ✅ 已完成：添加 `hzense.com`，完成 DNS 与 SSL 验证。
5. ✅ 已完成：添加 `www.hzense.com` 并重定向到根域名。
6. ✅ 已完成：建立 canonical、sitemap、robots、错误界面与基础安全响应头。
7. 🚧 进行中：验证生产日志与基础监控后，停止维护旧 Hosted Alpha。
8. ✅ 已完成：创建 Neon PostgreSQL 18 / pgvector 0.8.6 实例与受限迁移角色，使用真实 direct TLS endpoint 完成 preflight → snapshot → migrate → verify；随后解除 Vercel Production 项目连接并确认集成注入的数据库变量均不存在。
9. ⏳ 未执行：以新备份应用并验证 `0002`，创建 `hzense_topic_sync`，再完成 Topic 生产 dry run → Apply → 独立验证 → no-op 重跑。
