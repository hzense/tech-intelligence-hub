# 四项人工确认发布：生产启用记录

归档说明（2026-09-27）：本文是当时的操作与验收快照，不证明当前生产配置或具体候选已发布；归档不补做真实发布／撤回验收。

## 授权与边界

- 2026-09-25，用户明确同意保留新备份，在恢复能力尚未演练的风险下执行 0025、两个专用角色最小授权及生产环境配置，并确认维护期间无其他数据库或发布操作。
- 此授权不包括调用 AI、公开真实候选或扩大旧角色权限。新功能在数据库、角色与环境核验完成前保持关闭。
- PR #163 已合并至 `c5fef9c8da55c1b98c2aac0fcf1e18a4058b9242`；PR/main CI 均成功。生产部署 `dpl_BBxhuyhjFMV1e5z4oZwxdZ1L7mBY` READY 并绑定 hzense.com。页面 200、新接口未登录 401，只证明代码与鉴权上线，不证明功能启用。

## 本批准备

- 只读预检 [36179160200](https://github.com/hzense/tech-intelligence-hub/actions/runs/36179160200) 经操作者审批成功，`pendingMigrationCount: 1`；未执行迁移。
- Neon 已创建 `pre-editorial-publication-0025-2026-09-25`，ID `br-red-bonus-avzoho4h`；父分支为 main，复制当前数据与结构，控制台确认成功，保留至 `2026-10-02T19:25:33Z`。这只证明备份存在，不证明恢复能力已演练。该备份引用已保存到 production-maintenance 环境。
- 维护代码新增独立 0025 授权范围：只接受一个待迁移文件，固定 26 项完整清单，绑定目标和备份，执行锁内复核实际文件与连接身份。旧 0024 风险范围不扩展。
- 本地维护回归 759 项通过；生产备份、迁移、角色、凭据配置和最终启用结果须按实际执行另行补记。

## 维护规则上线

- [PR #164](https://github.com/hzense/tech-intelligence-hub/pull/164) 的 Codex 评论未指出重大问题，但没有 GitHub 正式 Review 记录；PR CI 与预览部署通过后合并。本地 main 当时已同步至 `82d7b5a23fb7bcbeee16a037913d1cfc41733d99`；main [CI 36180004357](https://github.com/hzense/tech-intelligence-hub/actions/runs/36180004357) 全部成功。
- Neon main／hzense 只读查询确认会话为数据库 owner、迁移记录 25 项、新 editorial 角色数 0。Vercel 环境变量搜索 `HZENSE_EDITORIAL` 无结果；功能未启用。
- 新 main 的只读 [preflight 36180474811](https://github.com/hzense/tech-intelligence-hub/actions/runs/36180474811) 经审批成功，待迁移数 1。用本地已合并的固定清单和目标／备份重新计算，四项指纹均与线上输出一致：清单 `d449870cdbf67b13d1fc79c4692d392f0f452e274dd42267b5a7df0b3980d069`，计划 `e260dba7d7c85db10bc0b2dc0928ab878d810da002c23a4d33f9ac225eeb9d14`，目标 `a4b0b65a20f6de69fe7ca0659d793d5b16b1a2ed1a733a7f59861e36bb28028a`，备份引用 `35ab7a8743a1c2d9017657eafd8eac4552024d35a7dac1a50f0dd58db0ee5e41`。
- 迁移前只读 [ACL 采集 36183207113](https://github.com/hzense/tech-intelligence-hub/actions/runs/36183207113) 经审批成功。两个独立采集指纹一致，下载附件后按仓库合约重建核对通过，基线为 `77bb4f5a86f8327059f6d8229c367a7f923ae9f3c9e6c88015a8254ffc7ab41d`。目标及备份指纹匹配本批预检；恢复状态仍为 `unverified-risk-accepted`，不将采集完整性当作恢复演练。
- 实际 [迁移 36183596300](https://github.com/hzense/tech-intelligence-hub/actions/runs/36183596300) 经审批成功，输出 `migrationCount: 26`、`tableCount: 58`。批准材料精确绑定 `82d7b5a`、本次运行／attempt 1、上述 ACL 基线、目标、新备份、固定迁移清单和单文件计划，有效至 `2026-09-25T22:05:42.861Z`。实际输出的四项指纹均与批准一致，风险接受指纹为 `376e13b8554f4d6b736bc3e0dd2a97bbcf62676eb62cf38ae817060f3b8c9cbe`；恢复能力仍未演练。
- 独立只读 [verify 36183884722](https://github.com/hzense/tech-intelligence-hub/actions/runs/36183884722) 经审批成功，`operation: verify`、`status: succeeded`、`migrationCount: 26`、`tableCount: 58`，运行提交为 `82d7b5a`。该步骤核验完整数据库合约，未重复执行迁移或授予权限。
- 独立核验后，Neon main／hzense 只读查询再次确认迁移 26 项、editorial 角色数 0；切换 neondb 核对 `neondb_owner` 具备创建角色能力。
- 用户在实际执行前确认创建及最小授权后，于 Neon main／neondb 执行仓库 `create_editorial_roles.sql`，两个 CREATE 和 COMMIT 均成功；随后在 main／hzense 执行 `configure_editorial_roles.sql`，保护检查、五项显式 GRANT 和 COMMIT 均成功。未设置密码或扩大旧角色权限。
- 独立 owner 只读 ACL 对照结果：reader 为 4 项字段 SELECT 权限；writer 为 28 项字段权限（发布记录 10 项 SELECT + 10 项 INSERT、生成任务 4 项 SELECT、领域 4 项 SELECT）。两者 `exact_column_acl`、`restricted_role`、`no_destructive_privileges`、`database_acl_safe` 均为 true；均 LOGIN、连接上限 2。该核验不替代后续专用凭据的真实连接及应用完整角色合约核验。
- 操作者随后确认已完成两个新角色的密码设置；本记录不保存密码，也不将操作者确认视为实际连接验收。
- 经具体凭据传输及生产应用访问授权确认，Vercel 已保存 `HZENSE_EDITORIAL_DATABASE_URL`、`HZENSE_EDITORIAL_READER_DATABASE_URL`，页面确认均为 Production Secret，未配置到 Preview 或 Development。使用 pooled 目标、显式端口及规定 TLS 参数；未打开发布开关。
- 为应用新环境变量，已从现有生产版本重新部署同一已通过 CI 的提交 `82d7b5a`，部署 ID 为 `dpl_552stgefn3nbtn2U8Np11kPWwLvV`。最终状态 READY、Production、`aliasError: null`，别名含 `hzense.com`、`www.hzense.com`。构建约 110 秒。
- 部署后只读检查：`https://hzense.com/signals` 返回 200；未登录访问 `/api/admin/editorial-signals` 返回 401。对该部署 `20:16:45Z–20:26:45Z` 的 error/fatal 日志查询无结果，不扩大为长期无错误结论。
- 本轮仍未设置 `HZENSE_EDITORIAL_PUBLICATION_ENABLED=1`。已核对代码：开关关闭时跳过新 reader/writer 的连接，所以本轮部署及网页检查不证明新凭据真实认证成功；完整角色合约与实际连接验收留待启用阶段。未调用 AI、未发布真实候选。

本记录不包含凭据、原始材料或真实候选内容。

## 发布开关启用

- 操作者明确要求“启用开关”后，已保存 `HZENSE_EDITORIAL_PUBLICATION_ENABLED=1`，类型为 Config，仅 Production。两个连接仍为 Production Secret，没有扩大环境范围。
- 已重新部署同一提交 `82d7b5a`，部署为 `dpl_4JKrTVtfSg3RRVaCukB3j33fG8f9`；最终 READY、Production、`aliasError: null`，已绑定 `hzense.com` 和 `www.hzense.com`，构建约 134 秒。
- 已恢复既有授权管理员会话，只读打开已有候选确认页并全量刷新。两次均显示“待确认发布”，日期、组织、人物、领域预填已加载，活动领域选项可读，“确认发布”“保存补充”“核对已保存状态”按钮可用。未修改字段、未点击保存或发布。该页面真实 GET 路径已通过 writer 连接、角色合约和必要读取；不是单纯本地 UI 状态。
- 日志按 `/api/admin/editorial-signals` 聚合：两次 200、一次未登录检查 401。生产首页与信号页均 200；信号页正文包含正常标题及列表卡片，无检测到的错误页标记。结合开关启用后的动态 reader 路径，公开读取未出现连接或角色合约错误。本次检查未出现 editorial 公开记录链接，不将既有 Seed 卡片当作新候选已发布。
- 该部署 `20:32:25Z–20:42:25Z` error/fatal 日志查询无结果。核验覆盖本次短窗口，不代表持续监控或完整写入验收；未改动日志转发配置。
- 发布能力现已启用，仍需管理员主动确认具体候选才会公开。本轮没有调用 AI、创建任务、保存发布材料或公开任何候选；真实发布／撤回写入验收未执行。候选确认页已留给操作者。
