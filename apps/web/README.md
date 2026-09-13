# HZense Web 应用

HZense 科技情报网站，使用 Next.js App Router、React 和 TypeScript 构建，工作区包名为 `@hzense/web`。

## 当前功能

应用已包含响应式首页、桌面与移动导航、明暗主题切换，以及以下页面：

| 路由                            | 内容                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `/`                             | 首页与内容入口                                          |
| `/daily`、`/daily/[date]`       | 日报列表与按日期访问的正文，包含历史回顾样例            |
| `/weekly`、`/weekly/[week]`     | 周报列表与正文                                          |
| `/insights`、`/insights/[id]`   | 洞察文章列表与正文                                      |
| `/topics`、`/topics/[id]`       | 专题列表与关联内容                                      |
| `/signals`、`/signals/[id]`     | 信号列表、详情与原始来源                                |
| `/resources`、`/resources/[id]` | 资源列表、详情与关联信号                                |
| `/radar`                        | 科技雷达、领域／成熟度／趋势筛选与评分依据              |
| `/search`                       | 公开内容搜索与类型筛选                                  |
| `/admin/login`、`/admin`        | Google 管理员登录及最小受保护首页；不是采集或发布操作台 |
| `/api/admin/session`            | 独立鉴权的只读管理员会话 API                            |

雷达目前展示手工维护、带评分证据的结构化示例快照。新版产品方向见 [Signal-first v2 设计](../../docs/SIGNAL_FIRST_REDESIGN.md)；其中的 AI 生产、版本化业务数据与产品迁移属于待实施设计，不能据此视为当前应用已经提供的能力。

## 管理员认证

管理员入口使用 NextAuth.js `4.24.15` 的 Google OAuth，仅授权服务端 `HZENSE_ADMIN_EMAIL` 指定的单个 Gmail 账号。Google 资料必须满足 `email_verified=true`，身份绑定 Google `sub`；邮箱比较忽略大小写，但不去点、不扩展到整个邮箱域、不接受 `+` 别名。受保护页面和会话 API 分别执行服务端鉴权，会话授权自登录起绝对有效期为 1 小时。

生产配置需要 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL` 和 `HZENSE_ADMIN_EMAIL`。全部只在 Vercel **Production** 环境保存，不使用 `NEXT_PUBLIC_` 前缀，也不把真实邮箱或密钥写进仓库。`NEXTAUTH_URL` 必须精确为 `https://hzense.com`，Google OAuth Web application 的授权回调为 `https://hzense.com/api/auth/callback/google`。Preview 认证禁用；配置缺失时，登录按钮禁用并显示明确提示。

当前只接通认证代码入口：没有新增数据库权限，没有接入 Publisher、AI 或文档／链接批量上传，尚未执行生产部署和真实 Google OAuth 验收。Google Cloud 网页步骤、变量填写规则、本地隔离回归及上线验收要求见 [管理员登录配置说明](../../docs/ADMIN_AUTH.md)。公开页面本地开发不要求配置认证变量。

## 本地开发

使用 Node.js 24 与仓库指定的 pnpm 版本，在仓库根目录执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @hzense/web dev
```

`dev` 的前置脚本会先构建 `@hzense/content` 和 `@hzense/search`。从工作区运行命令可保持内容读取所需的目录关系。

## 内容与搜索读取

- [`lib/content-runtime.ts`](lib/content-runtime.ts) 通过 `@hzense/content` 读取仓库中的 `content/`、`data/seed/` 与受控分类体系（Taxonomy）。日报、周报和洞察仅展示 `published` 内容；专题排除 `archived` 状态。
- [`lib/seed-runtime.ts`](lib/seed-runtime.ts) 读取 YAML 种子数据：公开信号接受 `accepted` 或 `reviewed` 状态，并优先按事件发生时间 `occurred_at` 排序；资源仅展示 `active` 实体。
- [`lib/topic-assessments.ts`](lib/topic-assessments.ts) 将 Topic 正文与该专题的最新雷达快照组合成只读 `assessment`。专题列表、详情与首页／雷达的四项指标统一来自 `data/seed/radar.yaml`，不从 Markdown 回退；缺快照显示 `—`／“待评估”并排在已评分专题之后。Topic Markdown 禁止重复填写评分，现有内容校验会拦截；评分更新仍需要构建发布，不会因新增信号自动重算。
- [`lib/search-runtime.ts`](lib/search-runtime.ts) 将可公开内容转成统一搜索文档，复用 `@hzense/search` 的投影与排序规则。
- [`lib/server/search.ts`](lib/server/search.ts) 在服务端选择搜索模式。`HZENSE_SEARCH_MODE` 支持 `in-process`、`shadow`、`database`，未设置时使用 `in-process`；`shadow` 比较两种结果并返回进程内结果，`database` 直接使用数据库查询。

数据库读取实现位于 [`lib/server/runtime-reader.ts`](lib/server/runtime-reader.ts)，健康检查路由为 `/api/health/database`。本说明不代表生产数据库配置、搜索索引同步或部署已经完成；相关操作与验收以仓库运行手册为准。

## 常用检查与构建

以下命令均在仓库根目录执行：

```bash
pnpm --filter @hzense/web lint
pnpm --filter @hzense/web typecheck
pnpm --filter @hzense/web test
pnpm --filter @hzense/web build
```

`test` 运行 `test/*.test.mjs`，前置脚本会构建搜索包；`build` 会先构建内容包和搜索包。完成构建后，可使用 `pnpm --filter @hzense/web start` 启动本地生产模式。浏览器端到端检查使用仓库根目录的 `pnpm test:e2e`。

## 样式与组件约定

主要样式采用语义化 CSS 类，颜色、表面、边框和阴影等设计变量集中在 [`app/globals.css`](app/globals.css)，并通过 `data-theme` 切换明暗主题。共用站点外壳、导航与主题按钮位于 [`components/`](components/)。

Tailwind 已接入工具链，但新增界面仍应沿用现有语义化类与设计变量；样式体系迁移需要团队另行决定。`packages/ui` 当前仍是预留边界，尚未提供独立组件包。
