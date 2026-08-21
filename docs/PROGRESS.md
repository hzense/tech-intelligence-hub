# HZense 开发进度看板

**最后更新：** 2026-08-21  
**当前阶段：** Website MVP Alpha  
**仓库：** [hzense/tech-intelligence-hub](https://github.com/hzense/tech-intelligence-hub)

> 本看板区分“工程基础完成度”和“用户可用网站完成度”。百分比是基于下方验收清单的人工估算，不以文档数量或提交数量代替产品进展。

## 总览

| 进度轴 | 当前进度 | 状态 | 判断 |
|---|---:|---|---|
| 开发基础建设 | 85% | 🟡 基本完成 | 架构、Monorepo、数据模型和校验工具已建立，完整 CI 已通过；依赖锁定仍待完成 |
| 网站 MVP | 48% | 🟡 Alpha 可访问 | Home、Daily、Radar、响应式布局和主题已运行；内容管线、搜索和其余路由待接入 |
| 生产就绪度 | 12% | 🔴 尚未就绪 | 已有可访问 Hosted Alpha；尚无数据库、Vercel 生产部署和域名绑定证据 |

## 阶段看板

| 阶段 | 状态 | 完成度 | 完成定义 |
|---|---|---:|---|
| 0. 品牌与产品基线 | ✅ 完成 | 100% | HZense 品牌、产品定位、模块、官方域名和 MVP 范围确定 |
| 1. 技术与信息架构 | ✅ 完成 | 100% | 技术栈、Source of Truth、信息模型、taxonomy 和 ADR 确定 |
| 2. Development Foundation | 🟡 验证中 | 85% | Monorepo、Schema、Migration、Validation、Seed 与 CI 已验证；可重复锁定安装仍待完成 |
| 3. Web Application Shell | ✅ 完成 | 100% | Next.js、Tailwind、App Router、主题、全局布局和导航可运行 |
| 4. MVP 内容与功能 | 🟡 开发中 | 35% | Home、Daily 和 seed Radar 可用；Markdown runtime、搜索和其余核心路由待完成 |
| 5. Production Release | 🔴 未就绪 | 10% | Hosted Alpha 可访问；Vercel、数据库、域名、HTTPS 验证与监控待完成 |

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
- [x] HZense 品牌 Logo、Open Graph 分享图和基础 metadata
- [x] [Hosted Alpha 检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)
- [x] 架构决策记录（ADR）

## 当前里程碑：Web MVP Alpha

### P0 — 先让基础可重复验证

- [ ] 生成并提交 `pnpm-lock.yaml`
- [ ] 使用 frozen lockfile 安装依赖
- [x] 确认 lint、typecheck、unit tests、content validation、seed validation 全部通过
- [x] 在 GitHub 上保留可核查的[绿色 CI 运行记录](https://github.com/hzense/tech-intelligence-hub/actions/runs/32432134570)
- [ ] 补充内容中的 Topic / Entity / Signal 交叉引用校验

### P0 — 建立第一个可见网站

- [x] 在 `apps/web` 初始化 Next.js App Router
- [x] 集成 Tailwind CSS 与 HZense 视觉基础
- [x] 实现全局布局、导航、页脚、亮色/暗色主题
- [x] 实现响应式首页
- [x] 实现 HZense Daily 列表页
- [x] 实现 HZense Daily 详情页
- [ ] 通过 `@hzense/content` 加载并校验 Markdown 内容
- [ ] 建立桌面端和移动端 Playwright 冒烟测试
- [x] 发布可访问的 [Hosted Alpha 检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)
- [ ] 生成第一个 Vercel Preview URL

### P1 — 扩展 MVP

- [ ] Insights
- [ ] Topics
- [ ] Weekly
- [ ] Signals
- [ ] Resources
- [ ] 基础关键词搜索
- [ ] 手工维护的 Radar
- [ ] sitemap、robots 和 canonical metadata

### P1 — 生产发布

- [ ] 创建托管 PostgreSQL / pgvector 实例
- [ ] 执行并验证生产 Migration
- [ ] 建立 Vercel Production Deployment
- [ ] 绑定 `hzense.com`
- [ ] 配置 `www.hzense.com` → `hzense.com` 重定向
- [ ] 验证 HTTPS、错误页、日志和基本安全配置

## MVP 验收状态

| MVP 验收项 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| Home、Daily、Insights、Topics、Weekly、Signals、Resources 路由 | 🟡 | Home 与 Daily 已实现；其余路由待开发 |
| 桌面端与移动端可用 | 🟡 | 响应式页面已发布；仍缺 Playwright 视觉与交互冒烟测试 |
| Markdown/MDX 通过验证层加载 | 🟡 | Schema 和 validator 已存在，但未接入 Web runtime |
| Topic / Entity 引用无断链 | 🟡 | Seed 引用有基础校验，内容引用尚未完整校验 |
| 基础关键词搜索 | ⬜ | 只有 Search 边界与数据库结构 |
| 手工 Radar | 🟡 | 首页 seed Radar 已可用；尚未接入正式数据目录 |
| 亮色与暗色主题 | ✅ | Web Shell 已实现主题切换 |
| CI 全部通过 | 🟡 | [Web MVP PR CI 已通过](https://github.com/hzense/tech-intelligence-hub/actions/runs/32432134570)；仍缺依赖锁文件与 frozen install |
| Vercel 生产部署与域名 | ⬜ | 已有 Hosted Alpha，但 Vercel 与正式域名尚未配置 |
| sitemap、robots、canonical metadata | ⬜ | 已有基础 metadata 与 Open Graph；sitemap、robots 和 canonical 待实现 |

## 当前风险与阻塞

| 优先级 | 风险 | 处理方式 |
|---|---|---|
| P0 | 没有 lockfile，构建不可完全复现且 CI 仍使用非冻结安装 | 生成并提交 lockfile，然后切换到 frozen install |
| P0 | Web 页面仍使用 seed 内容，尚未接入 `@hzense/content` | 下一迭代优先接入 Markdown runtime 和引用校验 |
| P1 | 日期字段当前只校验格式，不校验真实日历日期 | 后续增加语义日期校验与边界测试 |
| P1 | 样例内容主要来自 2024 年，无法代表日常更新能力 | Web Alpha 后接入当前 Daily 内容生产流程 |
| P1 | 没有 Issue / PR 任务流 | 后续里程碑拆分为可验收 Issue，通过 PR 合并 |
| P1 | 数据库与 Vercel 部署尚未落地 | 先用 Hosted Alpha 验证产品，再开通生产基础设施 |

## 进度更新规则

1. 每次合并到 `main` 后更新本看板。
2. 只有可运行、可测试或可访问的结果才能计入完成度。
3. “文档已写”不等于“功能已实现”；“Workflow 已定义”不等于“CI 已通过”。
4. 任务完成必须附带至少一种证据：测试结果、绿色 CI、预览链接、生产链接或可核查文件。
5. Website MVP 完成度以 [MVP Acceptance Criteria](./MVP_ACCEPTANCE.md) 为准。

## 更新记录

| 日期 | 更新 |
|---|---|
| 2026-08-21 | 发布 Web MVP Alpha：完成 Home、Daily、Radar、响应式 Shell、主题与品牌资源，并提供可访问 Hosted checkpoint |
| 2026-08-20 | 创建首版进度看板；修复 pnpm 11 构建授权与 YAML 日期校验；Foundation CI 首次完整通过 |
