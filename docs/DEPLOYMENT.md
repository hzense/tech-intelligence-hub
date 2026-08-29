# HZense 部署手册

## 目标

GitHub 仓库 `hzense/tech-intelligence-hub` 的 `main` 分支是网站唯一正式源码。Pull Request 生成 Preview Deployment；合并到 `main` 后生成 Production Deployment。旧 Hosted Alpha 仅用于历史对照，在正式域名切换后停止维护。

## 当前部署

- 正式生产域名：https://hzense.com/
- Vercel Production：https://tech-intelligence-hub-web.vercel.app/
- 域名策略：`www.hzense.com` 重定向到 `hzense.com`
- 2026-08-25 线上验收：HTTPS、HTTP → HTTPS、`www` → 根域名、Home、Daily 列表与 Daily 动态路由均正常
- 当前已建立：canonical、sitemap、robots、错误界面、基础安全响应头和桌面/移动端 Playwright 冒烟测试
- 2026-08-29 已通过 Vercel Marketplace 创建 Neon Free 生产实例 `hzense-production-postgres`，仅连接 Production；实时核验为 AWS `us-east-1`、PostgreSQL 18、可用 pgvector 0.8.6，生产 Migration 尚未执行

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

网站构建需要读取 Root Directory 之外的两个目录：

- `content/`：正式 Markdown/MDX 内容
- `data/seed/`：Topic、Entity 和 Signal 引用目录

`apps/web/next.config.ts` 将 output file tracing root 设置为仓库根目录，并为 Home、Daily 列表与 Daily 动态详情路由显式包含以上文件。Vercel 项目仍必须开启 “Include source files outside Root Directory”，否则构建环境在 Next.js 开始追踪之前就可能缺少这些源文件。

## 发布门禁

每次 PR 必须通过：

1. frozen pnpm install
2. lint 与 TypeScript typecheck
3. 从 `apps/web` 直接执行的部署构建
4. 全 workspace 生产构建
5. 单元测试
6. 内容 Front Matter 与交叉引用校验
7. Seed 数据校验
8. Desktop Chrome 与 Pixel 7 视口的 Playwright 生产冒烟测试

Vercel Preview URL 可作为界面验收证据，但不能替代 GitHub Actions。只有 PR 最终 head 的 CI 与 Preview 均通过后才能合并。

CI 同时支持 GitHub Actions 的 `workflow_dispatch` 手动触发入口。当自动事件未创建运行记录时，应从 Actions 页面选择 CI workflow 和目标分支手动运行；手动运行必须对应 PR 的最终 head commit。

## PostgreSQL 首次生产迁移

当前 Vercel 项目已注入 Neon 集成变量，但它们属于默认 owner，不能用于生产迁移；GitHub `Production` environment 仍未配置受限迁移角色 secret，Web runtime 也尚未依赖 PostgreSQL。因此容器 CI 只能证明生产迁移工具链，不能冒充真实托管实例验收。按以下顺序执行：

1. 从 provider 控制台确认 PostgreSQL 18 的 direct/session endpoint；transaction pooling 不支持迁移器使用的 session advisory lock，不能使用。
2. 由 provider 或管理员安装已审核版本的 pgvector，创建一个 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`、不属于其他角色且拥有专用数据库的迁移角色，并从 `public` 撤销 `PUBLIC CREATE`。
3. 将 direct URL 作为 `DATABASE_DIRECT_URL` 注入受保护的执行环境。URL 必须显式使用端口和 `sslmode=verify-full`；host、port、database、user 另存为独立 `HZENSE_DATABASE_EXPECTED_*` 配置，不能从 URL 自动派生。
4. 执行 `pnpm db:preflight:production`。它只读检查真实 session、TLS、版本、权限、扩展、目标库与 migration history，不打印 URL 或凭据。
5. 在 provider 创建可恢复快照或执行受保护的 `pg_dump -Fc`，记录备份标识并验证可列出/恢复；备份不得上传到 GitHub Actions artifact。
6. 执行 `pnpm db:migrate`，随后执行 `pnpm db:verify:production`。后者只读复核表持久性、所有者、RLS/policy/trigger 状态、catalog、checksum、pgvector typmod 和数据不变量。
7. 再配置独立只读运行时角色与 Web 健康检查；迁移角色不得作为应用凭据。

禁止对生产运行 `pnpm --filter @hzense/database test:migrations`。该测试套件会创建、终止连接并删除多个临时数据库，只能使用显式的本地管理员 URL。

## 首次上线顺序

1. ✅ 已完成：导入 GitHub 仓库并按上表创建 Vercel 项目。
2. ✅ 已完成：用 PR 的 Preview Deployment 验证 Home、Daily 列表和至少一篇 Daily 详情。
3. ✅ 已完成：合并后验证 Production Deployment。
4. ✅ 已完成：添加 `hzense.com`，完成 DNS 与 SSL 验证。
5. ✅ 已完成：添加 `www.hzense.com` 并重定向到根域名。
6. ✅ 已完成：建立 canonical、sitemap、robots、错误界面与基础安全响应头。
7. 🚧 进行中：验证生产日志与基础监控后，停止维护旧 Hosted Alpha。
8. 🚧 进行中：Neon PostgreSQL 18 实例已创建并连接 Production；待建立受限角色、安装 pgvector 后，以真实 direct endpoint 完成 preflight → backup → migrate → verify。
