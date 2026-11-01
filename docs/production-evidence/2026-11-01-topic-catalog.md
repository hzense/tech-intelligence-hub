# 生产自动采集领域目录核对

日期：2026-11-01。**目录修复已完成，候选发布页面仍有独立权限阻断。** 正式 [topic-apply 41330016210](https://github.com/hzense/tech-intelligence-hub/actions/runs/41330016210) 在 `main@9b9c1cf590ab4e881f9b12bc52a34b3642861b6c` 上成功提交 42 项更新；执行器随后通过独立新连接核验完整投影，并由 owner 再次检查无剩余插入或更新。生产目录为 62 项、47 项启用、10 个一级领域全部可用，完整 Schema 为 33 项迁移、58 张表。后续页面验收发现 `0032` 后发布写入角色缺少新列权限，已只读核实并取得最小升级授权，尚未执行授权。未重跑付费采集、未发布信号或修改开关，不能把目录修复等同于完整采集链路已验收。

## 故障定位时的线上事实

下表记录最初定位时的快照，不代表修复后的当前状态。

| 项目           | 最初核对结果                                                             |
| -------------- | ------------------------------------------------------------------------ |
| 域名／生产提交 | `hzense.com`，`6ff843fd98cfb9e8cbdc966587e5be4c0e0e2ca7`（PR #247）      |
| 部署           | `dpl_3nCmaaqpchDk3vKXmiiLJNqCdcq1`，Production READY，域名别名指向此部署 |
| 采集配置       | `testing` r3，人工审核后发布                                             |
| 失败任务       | `eb9a5739-e114-fa7b-7221-ff400f45e2d8`                                   |
| 创建时间       | `2026-11-01T01:07:20Z`（Europe/Berlin 02:07:20）                         |
| 阶段／错误     | `discovery_failed`／`discovery_topics_not_ready`                         |
| 费用           | 检索记账 `$0.0000`；尚未调用 AI、导入原文或生成候选                      |

Vercel 日志在 `01:07:26Z` 记录同一错误。后台任务详情列出的缺失范围为全部十个一级领域：Artificial Intelligence、Cybersecurity、Semiconductors、Robotics、Quantum、Cloud & Infrastructure、Autonomous Systems、Energy Technology、Space Technology、Biotechnology。当时信号管理页面只显示 AI Agents、AI Infrastructure、AI Security、Foundation Models、Humanoid Robotics 五个子领域。

迁移前 Neon SQL Editor 只读核对确认：`hzense`、`session_user = hzense_migrator`，登记 32 项迁移，最新为 `0031_retire_unused_tables.sql`；`topics` 共 62 行、启用 5 行，核验依赖封印总数／未失效数为 0／0。此前 `0031` 独立核验为 58 张表。因此故障是启用投影落后，不能将五个可选领域误写成数据库仅有五行。

发现模型调用前，`discoverSources()` 会比较所选领域与 `editorialTopicOptions()`；生产发布配置有效时，后者实时读取 `topics` 中 `runtime_enabled=true` 且未归档的条目。缺少任一所需领域即在付费前停止，不自动缩小采集范围。

## 代码交付与修复范围

| 交付                                                                | 合并与核对结果                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PR #248](https://github.com/hzense/tech-intelligence-hub/pull/248) | `e2581af06c518b6bec5a8661bd7fa9025af2fabc`；[主干 CI 41265488915](https://github.com/hzense/tech-intelligence-hub/actions/runs/41265488915) 成功；生产部署 `dpl_3n8B2sWvFdsiBYMp5gVsNLLiPv1K` READY，域名已核对                                                                                              |
| [PR #249](https://github.com/hzense/tech-intelligence-hub/pull/249) | `44a7aa96a9e94b3457f6b4099fa554758223175b`；定向回归 438 项、独立审核及 [主干 CI 41322782146](https://github.com/hzense/tech-intelligence-hub/actions/runs/41322782146) 通过；生产部署 `dpl_92bgm6vhxZFk32zQE9hy9LcUu9wL` READY，域名已核对                                                                  |
| [PR #250](https://github.com/hzense/tech-intelligence-hub/pull/250) | 当前 `main@9b9c1cf590ab4e881f9b12bc52a34b3642861b6c`；定向回归 476 项、独立审核及 1,320 组校验行为对比通过；[主干 CI 41328016802](https://github.com/hzense/tech-intelligence-hub/actions/runs/41328016802) 成功；生产部署 `dpl_DeCBs1HDZND4VKT8nS4MfpG8LhLJ` READY，`hzense.com` 别名指向此提交，本地已同步 |

- `topic-plan` 只读生成完整计划；`topic-apply` 仅使用独立 `hzense_topic_sync` 写入；`topic-verify` 只读比较完整投影。
- 保留 main／CI、运行绑定审批、备份和恢复证据门禁。审批须确认维护与发布冻结，未失效依赖封印非零或写入期间封印总数变化时停止。
- 写入前和事务加锁后重算投影与计划指纹；提交后以独立新连接核验全部目标字段，再检查无剩余变更。Migrator 仅做结构和状态核对，不替代专用角色写入。
- PR #249、#250 补齐固定白名单阶段／原因码，不输出原始异常、SQL、连接串或动态对象名；严格连接校验、审批规则和提交不确定性保护保持不变。两次诊断更新没有修改迁移、领域内容或角色授权。
- 保留原失败任务、费用和配置，不调整模型、预算、领域范围，也不自动重放任务。各批定向测试存在重叠，不相加作为总覆盖率。

## 生产维护时间线

以下时间均为 UTC。每次需要审批的运行分别绑定其实际提交、运行编号、尝试编号和有效期，没有沿用旧运行审批。

| 时间／运行                                                                                                                    | 实际结果                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `13:53:59Z`：[preflight 41312427432](https://github.com/hzense/tech-intelligence-hub/actions/runs/41312427432)                | 只读成功，待迁移 1 项；未写库或改权限                                                                                                   |
| `14:25:34Z`／`14:25:35Z`：[acl-capture 41314482877](https://github.com/hzense/tech-intelligence-hub/actions/runs/41314482877) | 两次只读权限基线一致，已归档并独立审核                                                                                                  |
| `14:48:45.4539246Z`：[migrate 41317293957](https://github.com/hzense/tech-intelligence-hub/actions/runs/41317293957)          | `0032` 成功，33 项迁移、58 张表；该步骤没有同步 Topic 数据                                                                              |
| `15:05:21.7410678Z`：[topic-plan 41318093575](https://github.com/hzense/tech-intelligence-hub/actions/runs/41318093575)       | 独立完整 Schema 核验成功；只读计划为新增 0、更新 42、不变 20，依赖封印 0／0，独立复审 PASS                                              |
| `15:16:40.206Z`：[topic-apply 41320254050](https://github.com/hzense/tech-intelligence-hub/actions/runs/41320254050)          | `blocked / unavailable`，`topicSyncMayHaveCommitted:false`；没有提交 Topic 数据，旧通用摘要不足以判断认证或 ACL 是否通过                |
| `16:10:27.2303752Z`：[topic-verify 41323966645](https://github.com/hzense/tech-intelligence-hub/actions/runs/41323966645)     | `dedicated-target / unavailable`，在专用地址本地校验阶段停止，尚未认证                                                                  |
| `16:34:41.4417606Z`：[topic-verify 41326991812](https://github.com/hzense/tech-intelligence-hub/actions/runs/41326991812)     | 补齐显式端口后仍为 `dedicated-target / connection-policy-invalid`，没有打开数据库连接或写入                                             |
| `16:56:40.7433859Z`：[topic-verify 41328446114](https://github.com/hzense/tech-intelligence-hub/actions/runs/41328446114)     | 新诊断明确为 `dedicated-target / connection-host-mismatch`，专用地址主机与受审核生产目标不一致；没有认证或写入                          |
| `17:01:58Z`：专用 Secret 更新                                                                                                 | 用户保存完整正确模板，只替换既有角色密码；仅核对 Secret 名称与更新时间，未读取值、未改密或授权                                          |
| `17:03:56.4625439Z`：[topic-verify 41329376547](https://github.com/hzense/tech-intelligence-hub/actions/runs/41329376547)     | 到达 `topic-verification / projection-drift`；目标校验、认证、完整 Schema 和只读专用角色预检已通过，仅剩预期目录差异；没有生产 DML      |
| `17:06:30.1230223Z`：[topic-apply 41329669171](https://github.com/hzense/tech-intelligence-hub/actions/runs/41329669171)      | 环境审批先于新元数据绑定，`approval-run-mismatch` 在维护执行前阻止运行；没有写入。该运行及其参考审批不再复用                            |
| `17:09:33Z`／`17:09:34Z`：新审批绑定                                                                                          | 为新运行上传并核对审批元数据，先完成精确绑定再执行；保留四项计划指纹、本次备份、恢复证据和冻结声明                                      |
| `17:10:28.0770962Z`：[topic-apply 41330016210](https://github.com/hzense/tech-intelligence-hub/actions/runs/41330016210)      | `completed / success`；新增 0、更新 42、不变 20；`committed:true`、`verificationCompleted:true`，独立新连接投影核验及最终无差异检查成功 |

连接修正过程中，最初提供的模板误用 `sslmode=require`，已改为项目要求的 `sslmode=verify-full`；随后补齐显式 `:5432` 并修正主机。没有以关闭 TLS 校验、重设密码或扩大权限规避问题。旧计划中的 `roleExists` 只证明角色存在；实际认证和最小权限结论以最后的只读核验及正式写入执行器结果为准。

## 备份、恢复与 ACL 证据

本轮授权涵盖升级 `0032`、配置既有 `hzense_topic_sync` 专用凭据和同步目录；用户确认维护期间暂停其他结构修改、角色授权及发布。完整备份 `pre-topic-catalog-0032-20261101` 于 `13:46:36Z` 创建，到期策略为 Never，继续保留。隔离子分支 `restore-check-topic-0032-20261101` 于 `13:47:08Z` 创建，恢复后到期时间为 `2026-11-02T14:24:40Z`，按该计划自动过期，不再延长。

备份强身份 SQL 核对精确 32 项迁移、58 张表、可信 postmaster 身份及 owner 会话。备份与隔离副本初始完整数据摘要覆盖 58 张表、1,218 行，结构与 ACL 各覆盖 21 类，均一致。仅在隔离副本提交 canary 修改；修改后仅 `topics` 数据变化，其余 57 张业务表不变，演练断言及独立审核通过。

Reset 最终确认返回时，弹窗已关闭，供应商显示更新时间 `2026-11-01T14:24:41Z`；代理没有再次点击 Reset，不声称亲自执行最终点击。随后根据新时间线和完整摘要确认实际恢复：58 张表、1,218 行及数据／结构／ACL 摘要全部与备份一致，canary 消失，演练中撤销的列权限恢复；最终备份身份和摘要保持不变。

恢复证据清单封存 44 个文件，SHA-256 为 `4ee06b19d0ed213014ecf58a0cc8b70c8c96a82580031f389bcc6f4d2b02fa2d`；独立审核通过。诊断提交更新后再次逐项检查大小和 SHA-256，44 个文件仍完全一致。它证明迁移前的真实隔离恢复，不将其改写为迁移后新备份或新演练。

生产 ACL 双采样分别在 `14:25:34.912Z`、`14:25:35.225Z` 完成，正式指纹为 `09760ceb9b09f0514dde47633d0e3a3fb0aa54fbc03c691a802cbb1bc45c7399`。采集审批按建立时状态保留 `restoreRehearsed:false`、`aclRecoveryReviewed:false`，没有虚构恢复指纹；后续迁移和同步使用各自新运行绑定审批。该指纹是原始审阅基线，不冒充新采集结果；专用角色当前最小权限由执行器实际预检核对。

原始采集、绑定 SQL、供应商观察、比较和独立审核均保存在本机私有 `~/.codex/artifacts/hzense-recovery-0032-20261101/`。本文仅公开脱敏结论，不包含连接串、密码、Token、原始分支 ID 或原始日志导出。

## 最终同步结果与审批指纹

| 核对项         | 正式结果                                                      |
| -------------- | ------------------------------------------------------------- |
| 提交           | `9b9c1cf590ab4e881f9b12bc52a34b3642861b6c`                    |
| 结构契约       | 33 项迁移、58 张表，完整 Schema 核验通过                      |
| 目标目录       | 62 项，启用 47 项；10 个一级领域全部可用，缺失 0 项           |
| 本次变更       | 插入 0、更新 42、不变 20                                      |
| 提交及写后核验 | `committed:true`、`verificationCompleted:true`                |
| 独立核验       | 执行器独立新连接比较完整投影；最终 owner 计划无剩余插入／更新 |
| 依赖封印       | 未失效数 0，维护中封印总数保持不变                            |

| 指纹                    | 值                                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| `projectionFingerprint` | `f36edce0dd45602a29bf80c67068d93fe5f2d757bfd5b2e2dad7f277a5bf8b38` |
| `planFingerprint`       | `a3c1757e49fca1c8411f5e9bc8920f009c8604a7362b8ce11ac054afa76a60ab` |
| `manifestFingerprint`   | `20fcc247a55deaa9ca547cb2d6394a739fe3a851c6a682cd27eb47b62e61213d` |
| `targetFingerprint`     | `e9230d5ca7fa99779839d20fb025e3ca370179c579aeb1c385b6840f7f7aee93` |

这四项与原审阅计划一致。成功运行的 `planFingerprint` 对应本次写入前的计划，独立连接核验及最终无差异检查已包含在同一执行器中，不再为重复核对新增生产审批。

## 线上验收与后续边界

- 登录后生成任务列表成功读取 28 条既有任务，手动刷新显示“未调用 AI”。在三条既有候选上抽查信号管理页面，均无法读取发布信息；浏览器 Network 对同源只读请求确认 `503`／`{"error":"unavailable"}`。因此没有将页面验收记为通过，也没有把地址栏直接访问受保护 API 得到的 `403` 误当成同源读取结果。
- Neon 生产 `main`／`hzense` 中，以 `hzense_migrator` 执行单条只读 SELECT 再次确认启用 Topic 为 47 项。`hzense_editorial_writer` 的 `editorial_signal_revisions.publication_basis` SELECT／INSERT 和 `signal_generation_runs.snapshot` SELECT 均为 false；`hzense_editorial_reader` 的公开视图 `publication_basis` SELECT 为 true。
- 根因链路：`0032` 新建发布依据列但不授予权限；`readEditorialSignal()` 调用 `hasPublicationBasis()`，遇到“列存在但不能读取”主动拒绝，随后被映射为 `database_unavailable`／`unavailable`。这与 Topic 数据同步成功并不矛盾；不能把未知发布依据降级伪装为人工确认。
- 用户已授权通过新受保护维护入口，只给 writer 增加上述三项列能力，reader 既有权限保持。该增量允许 writer 读取完整生成快照，并在触发器及应用策略仍满足时写入发布依据，不是仅一个显示标签权限；本轮仍不启用自动发布、不调用 AI、不重放历史任务。升级需经过独立 SQL／代码审核、隔离数据库测试、运行绑定审批和写后独立核验；当前尚未执行生产授权。
- 已实现 `editorial-capability-plan`／`editorial-capability-grant`，固定增量 SQL SHA-256 为 `14304aa16b84e8f3598eac1bee0e51faefb0865aa834e669715247e30827502e`。隔离 PostgreSQL 18／pgvector 0.8.6 的新测试文件 50 项通过，覆盖完整执行器计划→授权→独立新连接核验、reader 不变、部分权限拒绝及失败回滚；生产 TLS／目标和 GitHub 门禁由独立单元测试覆盖，不把本地 fixture 冒充生产核验。独立评审发现并修正维护入口回调透传遗漏，补齐写后 ACL 指纹回执，复审无未解决阻断。
- **仍待完成：** 权限升级后重新只读核对页面 `topicOptions` 为 47 项且包含全部 10 个一级领域；该入口与采集前置检查共用目录读取函数。
- 目录读取每次查询数据库，接口禁止缓存；重新打开候选或刷新页面即可，不因本次数据同步另行部署。自动采集旧失败详情保留原 `discoveryMissingTopics`，它是历史回执，不会随目录修复被改写。
- 本轮没有重跑付费采集、生成或发布。下一次正常计划或另行授权的真实采集回执才能证明后续联网发现、原文导入、候选生成及按策略发布的完整结果。
