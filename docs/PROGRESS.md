# HZense 开发进度看板

**最后更新：** 2026-09-04
**当前阶段：** Runtime Reader 最小权限生产接入与功能验收已完成；当前进入证据缺口、外部策略阻塞与上线后监控收尾
**仓库：** [hzense/tech-intelligence-hub](https://github.com/hzense/tech-intelligence-hub)

> 本看板区分“工程基础完成度”和“用户可用网站完成度”。百分比是基于下方验收清单的人工估算，不以文档数量或提交数量代替产品进展。

## 总览

| 进度轴       | 当前进度 | 状态          | 判断                                                                                 |
| ------------ | -------: | ------------- | ------------------------------------------------------------------------------------ |
| 开发基础建设 |     100% | ✅ 完成       | 架构、Monorepo、数据模型、冻结依赖安装和内容交叉引用校验均已通过 CI                  |
| 网站 MVP     |     100% | ✅ 验收完成   | Home、Daily、Weekly、Insights、Topics、Signals、Resources 与基础搜索均由验证内容驱动 |
| 生产就绪度   |      98% | 🟡 运维收尾中 | 线上路径及有界告警已验收；Runtime ACL 恢复证据、provider 指标和旧 Alpha 仍未关闭     |

## 阶段看板

| 阶段                      | 状态      | 完成度 | 完成定义                                                                             |
| ------------------------- | --------- | -----: | ------------------------------------------------------------------------------------ |
| 0. 品牌与产品基线         | ✅ 完成   |   100% | HZense 品牌、产品定位、模块、官方域名和 MVP 范围确定                                 |
| 1. 技术与信息架构         | ✅ 完成   |   100% | 技术栈、Source of Truth、信息模型、taxonomy 和 ADR 确定                              |
| 2. Development Foundation | ✅ 完成   |   100% | Monorepo、Schema、Migration、Validation、Seed、锁文件与冻结安装均已验证              |
| 3. Web Application Shell  | ✅ 完成   |   100% | Next.js、Tailwind、App Router、主题、全局布局和导航可运行                            |
| 4. MVP 内容与功能         | ✅ 完成   |   100% | Home、Daily、Weekly、Insights、Topics、Signals、Resources、基础搜索和独立 Radar 可用 |
| 5. Production Release     | 🟡 进行中 |    98% | 域名、Schema、Topic 投影、Runtime 及有界告警已验收；证据、provider 指标与访问待收尾  |

## 已完成

- [x] HZense 产品设计与品牌基线
- [x] `hzense.com` 作为正式生产域名
- [x] Next.js / PostgreSQL / Drizzle / pgvector / Vercel 技术架构
- [x] Information Model v2.0.0、证据完整性契约与 taxonomy
- [x] PR #29 固化 Taxonomy → Seed → Content 的 Topic 权威链、引用约束与 CI 门禁
- [x] PR #30 将 `0002_topic_projection.sql`、完整 Taxonomy 投影同步器和最小权限同步角色配置脚本合并到 `main`，完成仓库与 CI 交付
- [x] 2026-08-31 在新可恢复分支备份保护下完成生产 `0002`、最小权限 `hzense_topic_sync`、62 条 Topic 投影、独立验证与 0 变更 no-op 重跑
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
- [ ] Continuous Daily 自动 Draft PR（2026-09-04 保持默认 token `read` 的 repository enable 请求被组织策略以 HTTP 409 拒绝；`can_approve_pull_request_reviews=false`、发布变量缺失，未 dispatch/建分支/PR）
- [x] HZense 品牌 Logo、Open Graph 分享图和基础 metadata
- [x] [Hosted Alpha 历史检查点](https://hzense-technology-intelligence.zhenghu-tte.chatgpt.site)（2026-09-04 只读审计为 active v6 / public、匿名 HTTP 200）
- [ ] 经显式授权后将 Hosted Alpha 收紧为 owner-only，并验证匿名访问拒绝及正式站不受影响
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

## 当前里程碑：生产加固与上线后监控

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
- [x] 执行并验证 2026-08-29 生产基线（2 个 Migration、13 张表、当时 0 个待执行 Migration）与 2026-08-31 `0002`（当前 3 个 Migration、0 pending）
- [x] 建立 [Vercel Production Deployment](https://tech-intelligence-hub-web.vercel.app/)
- [x] 绑定 [`hzense.com`](https://hzense.com/)
- [x] 配置 `www.hzense.com` → `hzense.com` 重定向
- [x] 验证 HTTPS 与 HTTP → HTTPS 跳转
- [x] 验证错误页与基本安全响应头
- [x] 验证生产安全日志并启用小时级基础健康监控；2026-09-04 受控手工 run 33854492063 再次通过有界合约，此前的 scheduled-record 间隙仅记作调度延迟观察而非故障
- [x] PR #40 于 2026-09-04 合并为 `main@0012871`；精确 commit 的 Production 部署与直接健康检查通过，受控 run 33855492933 按预期在真实探针成功后触发单例 Issue #43，恢复 run 33855536113 仅追加一条恢复评论并关闭同一 Issue

### P1 — Git / YAML → PostgreSQL Topic 投影

- [x] PR #29 确立 Taxonomy、Seed、Topic Content 和 PostgreSQL 派生投影的权威边界
- [x] PR #30 已将 `0002_topic_projection.sql` 与完整 Taxonomy 投影同步器合并到 `main` 并完成仓库与 CI 验证；该状态不代表任何生产数据库动作完成
- [x] 由操作者创建并验证新的可恢复分支备份，以受保护声明值应用并独立验证生产 `0002_topic_projection.sql`
- [x] 创建独立最小权限 `hzense_topic_sync`，以 owner 执行已评审 ACL 配置，并验证受保护的同步连接与 expected identity
- [x] 使用 reviewed source/plan fingerprint 完成持锁写前校验、事务 Apply、独立只读验证与 no-op 重跑；结果为 62 个 Topics、0 个未知行、fingerprint 匹配和 0 变更
- [x] 为 Runtime Reader 上线创建新的七天 provider 分支备份，盘点角色与数据库 ACL，设置 `hzense_runtime` 的 read-only session 默认值，并撤销未使用 `neondb` 的 ambient `PUBLIC` 访问
- [x] 将维护专用 `hzense_migrator` 的 connection limit 从 5 调整为 10，解除 Neon Tables 占满旧五连接上限导致的 `53300`；该决定不扩大 Web Runtime 权限，Runtime Web pool 上限仍为 1
- [x] PR #32–#35 合并独立 Runtime Reader、Server-only 数据库客户端、安全健康检查、有上限的只读业务查询及 Neon provider 合约
- [x] 以独立 catalog-only 查询确认目标 `hzense` Runtime ACL 当前已应用，并验证有效权限、直接授权来源与五列 allowlist
- [x] PR #36 合并小时级生产健康检查的 fail-closed 变量门禁，并固定允许的触发器与 cron
- [x] 在受保护流程中生成并保存独立 Runtime 凭据；候选 provider-object 合约连续两次通过目标库及精确允许的 Neon `postgres` / `template1` 完整生产 preflight
- [x] 仅向 Vercel Production 注入 pooled 连接与 expected identity，触发 Runtime-configured 重部署并独立验证健康检查、真实五列读取与安全日志
- [x] 记录 2026-09-04 操作者决定：知情接受既有 handling-exposure risk 并将 Production Runtime 轮换延期到本轮之外；本轮未读取或修改凭据/配置，轮换义务仍开放
- [x] PR #42 修复早期 CI 暴露的空 ACL 数组 SQLSTATE `22023`，完整 CI 通过并 squash 合并为 `main@0806e349`；精确 Production 部署和线上健康合约通过，且未执行生产 ACL 捕获或数据库 mutation
- [ ] 核验 mutation 前 provider backup/PITR；若无法找回，则正式接受历史缺口。PR #42 已交付 forward-only hashed backup reference / baseline fingerprint / session guard，但没有核验生产备份、采集生产 baseline 或重建历史 ACL，禁止据此再次 normalization
- [x] 建立应用层有界数据库健康告警：安全分类 `53300` / `57014` / 通用查询错误 / 五秒总耗时，记录脱敏池计数，并经单例 Issue 创建与恢复关闭演练验收
- [ ] 补充 Neon PgBouncer client-capacity 与独立 provider 侧连接、池和数据库阈值监控；PR #40 不声称覆盖该边界
- [x] PR #41 的 FTS-0 canonical projection、排序器抽取、稳定 fingerprint 与完全平局 total-order 已通过最终评审、完整 CI、合并及 Production 兼容性验收
- [ ] FTS-1 数据库落地：独立 Migration、Search Document 持久化、PostgreSQL tokenizer/index、回填、查询 parity 与生产 cutover 均未执行

2026-08-31 的生产维护窗口已有现场证据：新分支备份确认可恢复，`0002` 已执行，3 个 Migration / 0 pending，`hzense_topic_sync` 与最小 ACL 已复核，dry run → Apply → 独立 verifier → no-op 全部完成，最终 62 个 Topics、0 个未知行且 reviewed fingerprint 匹配。随后完成了 Runtime Reader 的新七天回滚分支、角色/ACL 盘点、`hzense_runtime` read-only 默认值、`neondb` ambient ACL 隔离与 Migrator 连接容量治理；PR #32–#35 已把仓库实现与 Neon provider 合约合并到 `main`。2026-09-01 又以两组 catalog-only `SELECT` 独立确认目标 `hzense` ACL 的有效权限和直接授权来源，[脱敏结果](./production-evidence/2026-09-01-runtime-reader-acl.md)仅保留布尔值、计数与指纹。PR #36 于 2026-09-02 合并健康监控门禁，PR #38 于 2026-09-03 固定现场验收的 provider catalog 合约。同日，独立 Runtime 凭据与目标/保留库完整 preflight 通过；五个 server-only 值仅配置到 Vercel Production，Runtime-configured 部署、线上 health、真实五列读取、安全日志与小时级工作流首次手工运行均通过[功能/配置生产验收](./production-evidence/2026-09-03-runtime-reader-production-acceptance.md)。生产就绪度据此提高至 98%。2026-09-04，PR #40 的精确 Production 部署、健康合约、受控 incident 创建与无重复 recovery 关闭均通过；PR #42 随后修复 `22023`、通过完整 CI、合并并完成精确 Production 部署兼容性验收，但没有执行生产 ACL 捕获、provider backup/PITR 核验或数据库 mutation。PR #41 随后完成 FTS-0：完全平局以 ordinal type/ID 建立 total-order，最终评审无 Blocker/High/Medium，CI、Search `23/23`、Web 定向 `3/3`、精确 Production 部署、线上五结果搜索、数据库 health 和所选路由错误窗口均通过；FTS-1 数据库 Migration/持久化/index/回填/cutover 仍未执行。[脱敏运维检查点](./production-evidence/2026-09-04-operations-checkpoint.md)同时保留四项未闭环状态：操作者知情接受既有凭据处理暴露风险并将轮换延期到本轮之外，轮换义务仍开放；历史 ACL 恢复材料不足且 provider backup/PITR 未核验；Continuous Daily 被确认的组织策略阻断；Hosted Alpha 仍公开且 owner-only 尚待显式授权。

## MVP 验收状态

| MVP 验收项                                                     | 状态 | 当前证据 / 缺口                                                                                                                                                          |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home、Daily、Insights、Topics、Weekly、Signals、Resources 路由 | ✅   | PR #12–#14 已实现 Weekly、Signals、Resources 列表与详情路由，并通过 Vercel Preview 页面验收                                                                              |
| 桌面端与移动端可用                                             | ✅   | PR #11 在 Desktop Chrome 与 Pixel 7 视口验证 Home、Daily、Insights、Topics、404、metadata 与安全响应头                                                                   |
| Markdown/MDX 通过验证层加载                                    | ✅   | [PR #6 head CI](https://github.com/hzense/tech-intelligence-hub/pull/6/checks)验证同一加载器用于 CI 校验与 Web 构建                                                      |
| Topic / Entity 引用无断链                                      | ✅   | Seed 与内容引用均由 CI 校验                                                                                                                                              |
| 基础关键词搜索                                                 | ✅   | PR #16 接入六类公开内容、相关度排序、类型筛选及双视口验收                                                                                                                |
| 手工 Radar                                                     | ✅   | PR #17 接入页面与可视化；[PR #19](https://github.com/hzense/tech-intelligence-hub/pull/19)增加评分说明、明确 Signal 引用与 HTTPS 原始来源                                |
| 亮色与暗色主题                                                 | ✅   | Web Shell 已实现主题切换                                                                                                                                                 |
| CI 全部通过                                                    | ✅   | [PR #19 Checks](https://github.com/hzense/tech-intelligence-hub/pull/19/checks)验证生产依赖审计、构建、单测、内容/Seed、双视口 Radar 与真实 pgvector Migration 流程      |
| Vercel 生产部署与域名                                          | ✅   | [`hzense.com`](https://hzense.com/) 已上线；HTTPS、HTTP → HTTPS 与 `www` → 根域名跳转均已验收                                                                            |
| PostgreSQL 生产数据基线                                        | ✅   | PostgreSQL 18.6 / pgvector 0.8.6、13 张表、3 个 Migration / 0 pending 与 62 条 Topic 投影已完成独立生产验收；未知 Topic 为 0，reviewed fingerprint 匹配，no-op 为 0 变更 |
| Runtime Reader 生产接入                                        | ✅   | Production-only 配置、`READY` 部署、真实五列读取、安全日志与小时级工作流首次手工运行均通过独立验收                                                                       |
| sitemap、robots、canonical metadata                            | ✅   | App Router metadata routes 与页面 canonical 由 PR #9 的 Playwright 测试自动验证                                                                                          |

## 当前风险与阻塞

| 优先级             | 风险                                               | 处理方式                                                                                                                                     |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0（ACL 变更门禁） | Runtime ACL 历史恢复证据不足                       | PR #42 工具与 CI 已验收，但禁止再次 normalization；forward-only guard 不替代 provider 备份/恢复核验、生产双 baseline、人工恢复计划或隔离演练 |
| P1                 | 样例内容主要来自 2024 年，无法代表日常更新能力     | 由 organization owner 解除 Actions PR 策略阻塞，再启用变量并验证自动 Draft PR；机器人仍不得 ready/approve/merge                              |
| P1                 | 本轮延期轮换的 Production Runtime 凭据仍属高敏感值 | 既有 handling-exposure risk 已触发但被知情延期，义务仍开放；任何新增暴露/疑似滥用、异常认证或权限主体变化必须升级处理                        |
| P1                 | Neon 保留数据库依赖 provider-owned 默认 ACL        | 当前精确 provider-object 指纹已通过；持续逐库复核，任何 owner、模板标志、ACL、对象定义或间接路径漂移都阻断上线                               |
| P1                 | Provider 侧数据库容量与阈值可观测性仍有限          | PR #40 的有界应用告警已验收；另行建立 Neon PgBouncer client-capacity 及 provider 侧连接、池与数据库阈值监控                                  |
| P2                 | 历史 Hosted Alpha 仍公开                           | 保持 `hzense.com` 为唯一正式站；得到显式授权后改为 owner-only，并验证匿名拒绝。永久删除需另行 destructive 授权                               |

## 进度更新规则

1. 每次合并到 `main` 后更新本看板。
2. 只有可运行、可测试或可访问的结果才能计入完成度。
3. “文档已写”不等于“功能已实现”；“Workflow 已定义”不等于“CI 已通过”。
4. 任务完成必须附带至少一种证据：测试结果、绿色 CI、预览链接、生产链接或可核查文件。
5. Website MVP 完成度以 [MVP Acceptance Criteria](./MVP_ACCEPTANCE.md) 为准。
6. CI 证据必须对应 PR 最终 head commit；合并前最后核对一次，PR 内优先使用始终指向当前 head 的 Checks 链接。

## 更新记录

| 日期       | 更新                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | PR #41 FTS-0 通过最终评审、CI、Search `23/23`、Web `3/3` 并合并为 `main@83654c48`；精确 Production 部署、五结果搜索、DB health 与路由日志通过；FTS-1 数据库落地仍待执行                                  |
| 2026-09-04 | PR #42 修复空 ACL 数组 `22023` 后完整 CI 全绿并合并为 `main@0806e349`；精确 Production 部署/health 通过，未执行生产 ACL 捕获、provider backup 核验或数据库 mutation                                      |
| 2026-09-04 | PR #40 合并为 `main@0012871`，精确 Production 部署、直接 health、受控单例 incident 与恢复关闭通过；其他检查点风险不变                                                                                    |
| 2026-09-04 | [运维检查点](./production-evidence/2026-09-04-operations-checkpoint.md)：Continuous Daily 受组织策略 409 阻断；Alpha 仍 public；ACL 恢复证据不足；本轮保留高敏感 Runtime 凭据                            |
| 2026-09-03 | Runtime Reader 完成 Production-only 配置与 `READY` 重部署；health、真实五列读取、安全日志和小时级工作流首次手工运行均通过；凭据轮换仍待完成，生产就绪度更新为 98%                                        |
| 2026-09-03 | 验收前检查点：PR #36 已合并并通过 main CI；当时健康任务因仓库变量未设置而按设计跳过，公开探针仍为 HTTP 503，不能视作数据库健康证据                                                                       |
| 2026-09-02 | PR #36 合并显式 schedule/变量门禁、触发器与 cron 防漂移校验，并保留受控手工验证入口                                                                                                                      |
| 2026-09-01 | Neon catalog-only 复核确认 Runtime 目标 ACL 与五列 allowlist；脱敏矩阵及查询/结果 SHA-256 已入库，其他上线门禁不变                                                                                       |
| 2026-08-31 | Runtime Reader 上线前新建七天回滚分支；完成角色/ACL 盘点、Runtime read-only 默认值、`neondb` ambient ACL 隔离，并将维护 Migrator 上限由 5 调整为 10；生产凭据、目标 ACL、Vercel 与健康验收仍待完成       |
| 2026-08-31 | 新可恢复分支备份、生产 `0002`、3 个 Migration / 0 pending、最小权限 `hzense_topic_sync`、62 个 Topics / 0 unknown、reviewed fingerprint 与 0 变更 no-op 均完成独立验证；Runtime Reader 外部上线仍未执行  |
| 2026-08-31 | Runtime Reader 准备分支定义 `hzense_runtime` 五列只读边界、Production-only pooled 客户端、Node health、`iad1` 部署配置、Preview/CI fail closed 与安全日志；仓库变更仍待合并和生产验证                    |
| 2026-08-30 | PR #30 合并完整 Topic 派生投影交付：`0002_topic_projection.sql`、双 fingerprint 同步器、最小权限 `hzense_topic_sync` 配置脚本与 PostgreSQL 18 集成测试进入 `main`；所有生产数据库动作仍为 `not_executed` |
| 2026-08-30 | PR #29 合并 Topic 权威链：以 Taxonomy YAML 为 ID / 规范名 / primary parent / 跨域关系权威，Seed 拥有运行时状态，Content 作为本地化页面与完整门禁；PostgreSQL 仍是派生投影                                |
| 2026-08-29 | 真实 Neon 生产实例保留一份未设置自动过期时间的手动快照，完成 2 个 Migration、13 张表与 0 pending 独立复核；解除 Neon–Vercel 项目连接并确认集成数据库变量均不存在                                         |
| 2026-08-29 | PR #24–#25 固定 PostgreSQL 18 / pgvector 0.8.6 生产合约与 Neon 代理 TLS 证据                                                                                                                             |
| 2026-08-29 | PR #19 建立 Radar 评分级证据、精确一手来源、Information Model v2.0.0 与可回滚 PostgreSQL Migration 验证                                                                                                  |
| 2026-08-29 | PR #18 升级 Next.js / React 安全补丁版本，并在 CI 增加生产依赖审计门禁                                                                                                                                   |
| 2026-08-27 | PR #17 接入独立 Radar 路由、类型化示例快照、领域/阶段/趋势筛选与 Topic / Signal / Resource 关联内容                                                                                                      |
| 2026-08-27 | PR #16 接入六类公开内容的关键词搜索、类型筛选、相关度排序、导航入口及桌面/移动端验收                                                                                                                     |
| 2026-08-26 | PR #15 统一 Seed Schema 与引用校验入口，增加 CI 手动触发并修复进度文档格式                                                                                                                               |
| 2026-08-26 | PR #12–#14 接入 Weekly、Signals、Resources、类型化 Seed runtime、日期语义校验与实体关系图谱                                                                                                              |
| 2026-08-25 | PR #11 将已验证的 Topic Markdown 接入列表、动态详情、导航、关联情报、sitemap 与双视口冒烟测试                                                                                                            |
| 2026-08-25 | PR #10 将已验证的 Insight Markdown 接入列表、动态详情、首页、导航、sitemap 与双视口冒烟测试                                                                                                              |
| 2026-08-25 | PR #9 建立 canonical、sitemap、robots、错误界面、安全响应头及桌面/移动端 Playwright 发布门禁                                                                                                             |
| 2026-08-25 | `hzense.com` 正式上线；完成 HTTPS、HTTP → HTTPS、`www.hzense.com` → 根域名、首页与 Daily 路由验收                                                                                                        |
| 2026-08-23 | PR #7 建立 Vercel Preview 与 Production 自动部署，完成 Home、Daily 动态路由和 Logo 的首次线上验收，并补充部署构建门禁与运行手册                                                                          |
| 2026-08-22 | PR #6 将经过交叉引用校验的 Markdown runtime 接入 Home 与动态 Daily 路由，并把样例内容统一为中文                                                                                                          |
| 2026-08-21 | PR #4 完成依赖锁定、frozen install 和 Topic / Entity / Signal / Content 交叉引用校验，Development Foundation 达到验收标准                                                                                |
| 2026-08-21 | 发布 Web MVP Alpha：完成 Home、Daily、Radar、响应式 Shell、主题与品牌资源，并提供可访问 Hosted checkpoint                                                                                                |
| 2026-08-20 | 创建首版进度看板；修复 pnpm 11 构建授权与 YAML 日期校验；Foundation CI 首次完整通过                                                                                                                      |
