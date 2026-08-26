# HZense 开发进度看板

**最后更新：** 2026-08-26
**当前阶段：** Website MVP Alpha  
**仓库：** [hzense/tech-intelligence-hub](https://github.com/hzense/tech-intelligence-hub)

> 本看板区分“工程基础完成度”和“用户可用网站完成度”。百分比是基于下方验收清单的人工估算，不以文档数量或提交数量代替产品进展。

## 总览

| 进度轴 | 当前进度 | 状态 | 判断 |
|---|---:|---|---|
| 开发基础建设 | 100% | ✅ 完成 | 架构、Monorepo、数据模型、冻结依赖安装和内容交叉引用校验均已通过 CI |
| 网站 MVP | 92% | 🟡 Alpha 可访问 | Home、Daily、Weekly、Insights、Topics、Signals 与 Resources 已由验证内容驱动；基础搜索待接入 |
| 生产就绪度 | 65% | 🟡 基础防护已建立 | 正式域名、HTTPS、错误界面、搜索引擎元数据和安全响应头已建立；数据库、日志和监控待完成 |

## 阶段看板

| 阶段 | 状态 | 完成度 | 完成定义 |
|---|---|---:|---|
| 0. 品牌与产品基线 | ✅ 完成 | 100% | HZense 品牌、产品定位、模块、官方域名和 MVP 范围确定 |
| 1. 技术与信息架构 | ✅ 完成 | 100% | 技术栈、Source of Truth、信息模型、taxonomy 和 ADR 确定 |
| 2. Development Foundation | ✅ 完成 | 100% | Monorepo、Schema、Migration、Validation、Seed、锁文件与冻结安装均已验证 |
| 3. Web Application Shell | ✅ 完成 | 100% | Next.js、Tailwind、App Router、主题、全局布局和导航可运行 |
| 4. MVP 内容与功能 | 🟡 开发中 | 90% | Home、Daily、Weekly、Insights、Topics、Signals、Resources 和 seed Radar 可用；基础搜索待完成 |
| 5. Production Release | 🟡 进行中 | 65% | 域名、HTTPS、错误界面、搜索元数据和安全响应头已建立；数据库、日志与监控待完成 |

## 已完成

- [x] HZense 产品设计与品牌基线
- [x] `hzense.com` 作为正式生产域名
- [x] Next.js / PostgreSQL / Drizzle / pgvector / Vercel 技术架构
- [x] Information Model v1.1 与 taxonomy
- [x] pnpm workspace 与 Turborepo 工程边界
- [x] TypeScript、ESLint、Prettier、Vitest 和 Playwright 基础配置
- [x] PostgreSQL / Drizzle Schema 与初始 Migration
- [x] Markdown Front Matter Zod Schema 与基础单元测试
- [x] Topic、Entity、Relation、Source、Signal 种子数据
- [x] Daily、Weekly、Insight、Topic 样例内容
- [x] GitHub Actions CI 工作流定义
- [x] Foundation CI 完整通过（install、lint、typecheck、test、content validation、seed validation）
- [x] Next.js Web Shell、响应式首页、全局导航与亮色/暗色主题
- [x] HZense Daily 列表页和历史 seed 详情页
- [x] HZense Insights 列表页、动态详情页与首页入口
- [x] HZense Topics 列表页、动态详情页与关联情报入口\n- [x] HZense Weekly 列表页、动态详情页与 Daily / Topic 证据链接\n- [x] HZense Signals 列表页、动态详情页与类型化 Seed runtime\n- [x] HZense Resources 列表页、动态详情页与双向实体关系
- [x] 经过 Schema 与交叉引用校验的 Markdown/MDX Web runtime
- [x] HZense 品牌 Logo、Open Graph 分享图和基础 metadata
- [x] [Hosted Alpha 检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)
- [x] [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] GitHub PR Preview 与 `main` Production 自动部署
- [x] [正式生产域名](https://hzense.com/)与 HTTPS
- [x] `www.hzense.com` → `hzense.com` 重定向
- [x] canonical、sitemap 与 robots 搜索引擎元数据
- [x] 404、运行时错误与全局错误界面
- [x] 桌面端与移动端 Playwright 生产冒烟测试
- [x] 基础安全响应头
- [x] 架构决策记录（ADR）

## 当前里程碑：Web MVP Alpha

### P0 — 先让基础可重复验证

- [x] 生成并提交 `pnpm-lock.yaml`
- [x] 使用 frozen lockfile 安装依赖
- [x] 确认 lint、typecheck、unit tests、content validation、seed validation 全部通过
- [x] 在 GitHub 上保留可核查的[最终 head CI 记录](https://github.com/hzense/tech-intelligence-hub/pull/7/checks)
- [x] 补充内容中的 Topic / Entity / Signal 交叉引用校验

### P0 — 建立第一个可见网站

- [x] 在 `apps/web` 初始化 Next.js App Router
- [x] 集成 Tailwind CSS 与 HZense 视觉基础
- [x] 实现全局布局、导航、页脚、亮色/暗色主题
- [x] 实现响应式首页
- [x] 实现 HZense Daily 列表页
- [x] 实现 HZense Daily 详情页
- [x] 通过 `@hzense/content` 加载并校验 Markdown 内容
- [x] 建立桌面端和移动端 Playwright 冒烟测试
- [x] 发布可访问的 [Hosted Alpha 检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)
- [x] 生成第一个 [Vercel Preview URL](https://tech-intelligence-hub-web-git-c-d83d2c-zhenghu25-6909s-projects.vercel.app)（启用 Vercel Authentication）

### P1 — 扩展 MVP

- [x] Insights
- [x] Topics
- [ ] Weekly
- [ ] Signals
- [ ] Resources
- [ ] 基础关键词搜索
- [ ] 手工维护的 Radar
- [x] sitemap、robots 和 canonical metadata

### P1 — 生产发布

- [ ] 创建托管 PostgreSQL / pgvector 实例
- [ ] 执行并验证生产 Migration
- [x] 建立 [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] 绑定 [`hzense.com`](https://hzense.com/)
- [x] 配置 `www.hzense.com` → `hzense.com` 重定向
- [x] 验证 HTTPS 与 HTTP → HTTPS 跳转
- [x] 验证错误页与基本安全响应头
- [ ] 验证生产日志与基础监控

## MVP 验收状态

| MVP 验收项 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| Home、Daily、Insights、Topics、Weekly、Signals、Resources 路由 | ✅ | PR #12–#14 已实现 Weekly、Signals、Resources 列表与详情路由，并通过 Vercel Preview 页面验收 |
| 桌面端与移动端可用 | ✅ | PR #11 在 Desktop Chrome 与 Pixel 7 视口验证 Home、Daily、Insights、Topics、404、metadata 与安全响应头 |
| Markdown/MDX 通过验证层加载 | ✅ | [PR #6 head CI](https://github.com/hzense/tech-intelligence-hub/pull/6/checks)验证同一加载器用于 CI 校验与 Web 构建 |
| Topic / Entity 引用无断链 | ✅ | Seed 与内容引用均由 CI 校验 |
| 基础关键词搜索 | ⬜ | 只有 Search 边界与数据库结构 |
| 手工 Radar | 🟡 | 首页 seed Radar 已可用；尚未接入正式数据目录 |
| 亮色与暗色主题 | ✅ | Web Shell 已实现主题切换 |
| CI 全部通过 | ✅ | [PR #11 Checks](https://github.com/hzense/tech-intelligence-hub/pull/11/checks)验证 Topics 列表、详情、关联内容、canonical、sitemap 与双视口可用性 |
| Vercel 生产部署与域名 | ✅ | [`hzense.com`](https://hzense.com/) 已上线；HTTPS、HTTP → HTTPS 与 `www` → 根域名跳转均已验收 |
| sitemap、robots、canonical metadata | ✅ | App Router metadata routes 与页面 canonical 由 PR #9 的 Playwright 测试自动验证 |

## 当前风险与阻塞

| 优先级 | 风险 | 处理方式 |
|---|---|---|
| P1 | 日期字段当前只校验格式，不校验真实日历日期 | 后续增加语义日期校验与边界测试 |
| P1 | 样例内容主要来自 2024 年，无法代表日常更新能力 | Web Alpha 后接入当前 Daily 内容生产流程 |
| P1 | 数据库、生产日志与监控尚未落地 | 下一步创建托管 PostgreSQL / pgvector，执行 Migration，并完成 Vercel 日志与监控验收 |

## 进度更新规则

1. 每次合并到 `main` 后更新本看板。
2. 只有可运行、可测试或可访问的结果才能计入完成度。
3. “文档已写”不等于“功能已实现”；“Workflow 已定义”不等于“CI 已通过”。
4. 任务完成必须附带至少一种证据：测试结果、绿色 CI、预览链接、生产链接或可核查文件。
5. Website MVP 完成度以 [MVP Acceptance Criteria](./MVP_ACCEPTANCE.md) 为准。
6. CI 证据必须对应 PR 最终 head commit；合并前最后核对一次，PR 内优先使用始终指向当前 head 的 Checks 链接。

## 更新记录

| 日期 | 更新 |
|---|---|
| 2026-08-25 | PR #11 将已验证的 Topic Markdown 接入列表、动态详情、导航、关联情报、sitemap 与双视口冒烟测试 |
| 2026-08-25 | PR #10 将已验证的 Insight Markdown 接入列表、动态详情、首页、导航、sitemap 与双视口冒烟测试 |
| 2026-08-25 | PR #9 建立 canonical、sitemap、robots、错误界面、安全响应头及桌面/移动端 Playwright 发布门禁 |
| 2026-08-25 | `hzense.com` 正式上线；完成 HTTPS、HTTP → HTTPS、`www.hzense.com` → 根域名、首页与 Daily 路由验收 |
| 2026-08-23 | PR #7 建立 Vercel Preview 与 Production 自动部署，完成 Home、Daily 动态路由和 Logo 的首次线上验收，并补充部署构建门禁与运行手册 |
| 2026-08-22 | PR #6 将经过交叉引用校验的 Markdown runtime 接入 Home 与动态 Daily 路由，并把样例内容统一为中文 |
| 2026-08-21 | PR #4 完成依赖锁定、frozen install 和 Topic / Entity / Signal / Content 交叉引用校验，Development Foundation 达到验收标准 |
| 2026-08-21 | 发布 Web MVP Alpha：完成 Home、Daily、Radar、响应式 Shell、主题与品牌资源，并提供可访问 Hosted checkpoint |
| 2026-08-20 | 创建首版进度看板；修复 pnpm 11 构建授权与 YAML 日期校验；Foundation CI 首次完整通过 |
