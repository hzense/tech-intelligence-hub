# HZense 部署手册

## 目标

GitHub 仓库 `hzense/tech-intelligence-hub` 的 `main` 分支是网站唯一正式源码。Pull Request 生成 Preview Deployment；合并到 `main` 后生成 Production Deployment。旧 Hosted Alpha 仅用于历史对照，在正式域名切换后停止维护。

## 当前部署

- Vercel Production：https://tech-intelligence-hub-web.vercel.app/
- 首次线上验收：Home、Daily 列表、Daily 动态详情与 Logo 均正常
- 下一步：确认 PR Preview 自动部署后合并 PR7，再绑定 `hzense.com`

## Vercel 项目设置

| 设置 | 值 |
|---|---|
| Git Repository | `hzense/tech-intelligence-hub` |
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Include source files outside Root Directory | 开启 |
| Node.js Version | 24.x |
| Install Command | 使用 Vercel 自动检测的 pnpm workspace 安装 |
| Build Command | `pnpm build` |
| Production Branch | `main` |

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

Vercel Preview URL 可作为界面验收证据，但不能替代 GitHub Actions。只有 PR 最终 head 的 CI 与 Preview 均通过后才能合并。

## 首次上线顺序

1. 导入 GitHub 仓库并按上表创建 Vercel 项目。
2. 用 PR 的 Preview Deployment 验证 Home、Daily 列表和至少一篇 Daily 详情。
3. 合并后验证 Production Deployment。
4. 添加 `hzense.com`，完成 DNS 与 SSL 验证。
5. 添加 `www.hzense.com` 并重定向到根域名。
6. 验证 canonical、sitemap、robots、错误页与基础监控后，停止维护旧 Hosted Alpha。
