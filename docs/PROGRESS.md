# HZense 开发进度看板

**最后更新：** 2026-08-29
**当前阶段：** Website MVP Release Candidate
**仓库：** [hzense/tech-intelligence-hub](https://github.com/hzense/tech-intelligence-hub)

> 本看板区分“工程基础完成度”和“用户可用网站完成度”。百分比是基于下方验收清单的人工估算，不以文档数量或提交数量代替产品进展。

## 总览

| 进度轴       | 当前进度 | 状态              | 判断                                                                                 |
| ------------ | -------: | ----------------- | ------------------------------------------------------------------------------------ |
| 开发基础建设 |     100% | ✅ 完成           | 架构、Monorepo、数据模型、冻结依赖安装和内容交叉引用校验均已通过 CI                  |
| 网站 MVP     |     100% | ✅ 验收完成       | Home、Daily、Weekly、Insights、Topics、Signals、Resources 与基础搜索均由验证内容驱动 |
| 生产就绪度   |      80% | 🟡 数据基线已建立 | 正式域名、安全基线与生产数据库迁移已验收；Web 数据库接入、日志和监控待完成           |

## 阶段看板

| 阶段                      | 状态      | 完成度 | 完成定义                                                                             |
| ------------------------- | --------- | -----: | ------------------------------------------------------------------------------------ |
| 0. 品牌与产品基线         | ✅ 完成   |   100% | HZense 品牌、产品定位、模块、官方域名和 MVP 范围确定                                 |
| 1. 技术与信息架构         | ✅ 完成   |   100% | 技术栈、Source of Truth、信息模型、taxonomy 和 ADR 确定                              |
| 2. Development Foundation | ✅ 完成   |   100% | Monorepo、Schema、Migration、Validation、Seed、锁文件与冻结安装均已验证              |
| 3. Web Application Shell  | ✅ 完成   |   100% | Next.js、Tailwind、App Router、主题、全局布局和导航可运行                            |
| 4. MVP 内容与功能         | ✅ 完成   |   100% | Home、Daily、Weekly、Insights、Topics、Signals、Resources、基础搜索和独立 Radar 可用 |
| 5. Production Release     | 🟡 进行中 |    80% | 域名、安全基线与生产数据库迁移已验收；Web 数据库接入、日志与监控待完成               |

## 已完成

- [x] HZense 产品设计与品牌基线
- [x] `hzense.com` 作为正式生产域名
- [x] Next.js / PostgreSQL / Drizzle / pgvector / Vercel 技术架构
- [x] Information Model v2.0.0、证据完整性契约与 taxonomy
- [x] pnpm workspace 与 Turborepo 工程边界
- [x] TypeScript、ESLint、Prettier、Vitest 和 Playwright 基础配置
- [x] PostgreSQL / Drizzle Schema、顺序 Migration、事务执行器与 pgvector CI 验证
- [x] 受限迁移角色、Migration checksum manifest、生产 direct/TLS 预检与只读完整 schema verifier
- [x] Markdown Front Matter Zod Schema 与基础单元测试
- [x] Topic、Entity、Relation、Source、Signal 种子数据
- [x] Daily、Weekly、Insight、Topic 样例内容
- [x] GitHub Actions CI 工作流定义
- [x] Foundation CI 完整通过（install、lint、typecheck、test、content validation、seed validation）
- [x] Next.js Web Shell、响应式首页、全局导航与亮色/暗色主题
- [x] HZense Daily 列表页和历史 seed 详情页
- [x] HZense Insights 列表页、动态详情页与首页入口
- [x] HZense Topics 列表页、动态详情页与关联情报入口
- [x] HZense Weekly 列表页、动态详情页与 Daily / Topic 证据链接
- [x] HZense Signals 列表页、动态详情页与类型化 Seed runtime
- [x] HZense Resources 列表页、动态详情页与双向实体关系
- [x] 已发布 Daily、Weekly、Insights、Topics、Signals、Resources 的基础关键词搜索
- [x] 独立 Radar 页面、类型化快照、可分享筛选、评分级 Signal 证据与原始来源链接
- [x] 经过 Schema 与交叉引用校验的 Markdown/MDX Web runtime
- [x] Continuous Daily 确定性候选生成、完整 dry-run、人工发布门禁与回滚手册
- [ ] Continuous Daily 自动 Draft PR（组织策略暂时禁止 Actions 创建 PR；仓库发布开关保持关闭）
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
- [x] Neon PostgreSQL 18.6 / pgvector 0.8.6 生产实例、受限迁移角色、迁移前快照与完整 Migration 验证
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
- [x] Weekly
- [x] Signals
- [x] Resources
- [x] 基础关键词搜索
- [x] 手工维护的 Radar（独立路由、类型化快照、评分说明与可追溯证据链）
- [x] sitemap、robots 和 canonical metadata

### P1 — 生产发布

- [x] 创建托管 PostgreSQL 18 / pgvector 0.8.6 实例
- [x] 执行并验证生产 Migration（2 个 Migration、13 张表、0 个待执行 Migration）
- [x] 建立 [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] 绑定 [`hzense.com`](https://hzense.com/)
- [x] 配置 `www.hzense.com` → `hzense.com` 重定向
- [x] 验证 HTTPS 与 HTTP → HTTPS 跳转
- [x] 验证错误页与基本安全响应头
- [ ] 验证生产日志与基础监控

## MVP 验收状态

| MVP 验收项                                                     | 状态 | 当前证据 / 缺口                                                                                                                                                     |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home、Daily、Insights、Topics、Weekly、Signals、Resources 路由 | ✅   | PR #12–#14 已实现 Weekly、Signals、Resources 列表与详情路由，并通过 Vercel Preview 页面验收                                                                         |
| 桌面端与移动端可用                                             | ✅   | PR #11 在 Desktop Chrome 与 Pixel 7 视口验证 Home、Daily、Insights、Topics、404、metadata 与安全响应头                                                              |
| Markdown/MDX 通过验证层加载                                    | ✅   | [PR #6 head CI](https://github.com/hzense/tech-intelligence-hub/pull/6/checks)验证同一加载器用于 CI 校验与 Web 构建                                                 |
| Topic / Entity 引用无断链                                      | ✅   | Seed 与内容引用均由 CI 校验                                                                                                                                         |
| 基础关键词搜索                                                 | ✅   | PR #16 接入六类公开内容、相关度排序、类型筛选及双视口验收                                                                                                           |
| 手工 Radar                                                     | ✅   | PR #17 接入页面与可视化；[PR #19](https://github.com/hzense/tech-intelligence-hub/pull/19)增加评分说明、明确 Signal 引用与 HTTPS 原始来源                           |
| 亮色与暗色主题                                                 | ✅   | Web Shell 已实现主题切换                                                                                                                                            |
| CI 全部通过                                                    | ✅   | [PR #19 Checks](https://github.com/hzense/tech-intelligence-hub/pull/19/checks)验证生产依赖审计、构建、单测、内容/Seed、双视口 Radar 与真实 pgvector Migration 流程 |
| Vercel 生产部署与域名                                          | ✅   | [`hzense.com`](https://hzense.com/) 已上线；HTTPS、HTTP → HTTPS 与 `www` → 根域名跳转均已验收                                                                       |
| PostgreSQL 生产数据基线                                        | ✅   | PostgreSQL 18.6 / pgvector 0.8.6、受限迁移角色、迁移前快照、2 个 Migration 与 13 张表已在真实 Neon direct TLS endpoint 验收；独立复核为 0 个待执行 Migration        |
| sitemap、robots、canonical metadata                            | ✅   | App Router metadata routes 与页面 canonical 由 PR #9 的 Playwright 测试自动验证                                                                                     |

## 当前风险与阻塞

| 优先级 | 风险                                           | 处理方式                                                                                                       |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P1     | 样例内容主要来自 2024 年，无法代表日常更新能力 | Web Alpha 后接入当前 Daily 内容生产流程                                                                        |
| P1     | Web runtime 尚未接入生产数据库                 | 先提交可重复评审的运行时权限脚本和数据库客户端，再配置独立最小权限凭据与健康检查；禁止复用迁移角色或默认 owner |
| P1     | 生产日志与监控尚未落地                         | 验证 Vercel runtime logs、基础告警与后续数据库可观测性                                                         |

## 进度更新规则

1. 每次合并到 `main` 后更新本看板。
2. 只有可运行、可测试或可访问的结果才能计入完成度。
3. “文档已写”不等于“功能已实现”；“Workflow 已定义”不等于“CI 已通过”。
4. 任务完成必须附带至少一种证据：测试结果、绿色 CI、预览链接、生产链接或可核查文件。
5. Website MVP 完成度以 [MVP Acceptance Criteria](./MVP_ACCEPTANCE.md) 为准。
6. CI 证据必须对应 PR 最终 head commit；合并前最后核对一次，PR 内优先使用始终指向当前 head 的 Checks 链接。

## 更新记录

| 日期       | 更新                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-29 | 真实 Neon 生产实例保留永久快照 `pre-migration-2026-08-29T20:46:11Z`，完成 2 个 Migration、13 张表与 0 pending 独立复核；解除 Vercel 项目连接并确认集成数据库变量均不存在 |
| 2026-08-29 | PR #24–#25 固定 PostgreSQL 18 / pgvector 0.8.6 生产合约与 Neon 代理 TLS 证据                                                                                             |
| 2026-08-29 | PR #19 建立 Radar 评分级证据、精确一手来源、Information Model v2.0.0 与可回滚 PostgreSQL Migration 验证                                                                  |
| 2026-08-29 | PR #18 升级 Next.js / React 安全补丁版本，并在 CI 增加生产依赖审计门禁                                                                                                   |
| 2026-08-27 | PR #17 接入独立 Radar 路由、类型化示例快照、领域/阶段/趋势筛选与 Topic / Signal / Resource 关联内容                                                                      |
| 2026-08-27 | PR #16 接入六类公开内容的关键词搜索、类型筛选、相关度排序、导航入口及桌面/移动端验收                                                                                     |
| 2026-08-26 | PR #15 统一 Seed Schema 与引用校验入口，增加 CI 手动触发并修复进度文档格式                                                                                               |
| 2026-08-26 | PR #12–#14 接入 Weekly、Signals、Resources、类型化 Seed runtime、日期语义校验与实体关系图谱                                                                              |
| 2026-08-25 | PR #11 将已验证的 Topic Markdown 接入列表、动态详情、导航、关联情报、sitemap 与双视口冒烟测试                                                                            |
| 2026-08-25 | PR #10 将已验证的 Insight Markdown 接入列表、动态详情、首页、导航、sitemap 与双视口冒烟测试                                                                              |
| 2026-08-25 | PR #9 建立 canonical、sitemap、robots、错误界面、安全响应头及桌面/移动端 Playwright 发布门禁                                                                             |
| 2026-08-25 | `hzense.com` 正式上线；完成 HTTPS、HTTP → HTTPS、`www.hzense.com` → 根域名、首页与 Daily 路由验收                                                                        |
| 2026-08-23 | PR #7 建立 Vercel Preview 与 Production 自动部署，完成 Home、Daily 动态路由和 Logo 的首次线上验收，并补充部署构建门禁与运行手册                                          |
| 2026-08-22 | PR #6 将经过交叉引用校验的 Markdown runtime 接入 Home 与动态 Daily 路由，并把样例内容统一为中文                                                                          |
| 2026-08-21 | PR #4 完成依赖锁定、frozen install 和 Topic / Entity / Signal / Content 交叉引用校验，Development Foundation 达到验收标准                                                |
| 2026-08-21 | 发布 Web MVP Alpha：完成 Home、Daily、Radar、响应式 Shell、主题与品牌资源，并提供可访问 Hosted checkpoint                                                                |
| 2026-08-20 | 创建首版进度看板；修复 pnpm 11 构建授权与 YAML 日期校验；Foundation CI 首次完整通过                                                                                      |
