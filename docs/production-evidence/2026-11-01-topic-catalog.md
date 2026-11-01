# 生产自动采集领域目录核对

日期：2026-11-01。状态：受保护同步入口已通过 PR #248 合并并部署，主干 CI 成功；`0032` 生产迁移及随后独立完整 Schema 核验均已通过，确认为 33 项迁移、58 张表。隔离实际恢复核验和生产 ACL 双采样均已通过，恢复证据清单已封存并通过独立审核。独立只读 `topic-plan` 已成功并通过独立复审，计划更新 42 项、保留 20 项、不新增。用户已确认专用 Secret 使用 `sslmode=verify-full`。正式 `topic-apply` 经审批后失败，返回 `blocked`／`unavailable`，`topicSyncMayHaveCommitted: false`、`verificationCompleted: false`；通用摘要不足以确认根因，不能认定连接认证或 ACL 已通过。Topic 数据未提交，正在定位原因，不盲目重跑。本轮已执行生产结构写入，未调用付费 AI、未修改开关或权限；目录修复仍未完成。

## 故障定位时的线上事实

下表保留最初定位时的部署和失败任务，后续交付状态见“代码交付与生产准备”。

| 项目       | 核对结果                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| 域名       | `hzense.com`                                                             |
| 生产提交   | `6ff843fd98cfb9e8cbdc966587e5be4c0e0e2ca7`（PR #247）                    |
| 部署       | `dpl_3nCmaaqpchDk3vKXmiiLJNqCdcq1`，Production READY，域名别名指向此部署 |
| 采集配置   | `testing` r3，人工审核后发布                                             |
| 失败任务   | `eb9a5739-e114-fa7b-7221-ff400f45e2d8`                                   |
| 创建时间   | `2026-11-01T01:07:20Z`（Europe/Berlin 02:07:20）                         |
| 阶段／错误 | `discovery_failed`／`discovery_topics_not_ready`                         |
| 费用       | 任务显示检索记账 `$0.0000`；未调用 AI，未进入导入或候选生成              |

Vercel 运行日志记录发现步骤在 `2026-11-01T01:07:26Z` 以同一领域错误停止。登录后的自动采集详情保存了缺失清单：Artificial Intelligence、Cybersecurity、Semiconductors、Robotics、Quantum、Cloud & Infrastructure、Autonomous Systems、Energy Technology、Space Technology、Biotechnology，即全部十个一级领域。

正常后台信号管理页面读取同一可发布目录，仅显示五项：AI Agents、AI Infrastructure、AI Security、Foundation Models、Humanoid Robotics。当前仓库完整权威投影为 62 个节点，其中 47 个启用，覆盖全部十个一级领域。上述生产页面证据证明有效目录落后，不据此推断 `topics` 表实际只有五行，也不把缺失范围缩为近期新增的量子技术和生物技术两项。

迁移前在 Neon SQL Editor 执行只读核对，得到以下历史快照：

| 数据库核对项               | 结果                                          |
| -------------------------- | --------------------------------------------- |
| 当前数据库                 | `hzense`                                      |
| 登录角色                   | `session_user = hzense_migrator`              |
| 已登记迁移                 | 32 项，最新为 `0031_retire_unused_tables.sql` |
| Topic 总数／启用数         | 62／5                                         |
| 核验依赖封印总数／未失效数 | 0／0                                          |

这些是迁移前只读快照，不代表已完成完整 Schema／角色 ACL 核验或可沿用到未来写入。当时仓库需要 33 项迁移，而生产尚缺 `0032_automatic_signal_publication.sql`；`topic-plan`、`topic-apply`、`topic-verify` 均要求完整 Schema，因此需要先完成该迁移。后续迁移结果见下。

此前 `0031` 独立核验的生产结构为 32 项迁移、58 张表；上述迁移前只读账本与该阶段一致，不能将旧表数量或旧快照代替 `0032` 后的独立完整 Schema 核验。

执行器在调用发现模型前比较所选领域与 `editorialTopicOptions()`。生产发布启用时，后者读取 `topics` 中 `runtime_enabled=true` 且未归档的条目。任一所需领域缺失即停止，任务保留零费用。此次故障发生于该检查；代码部署已完成，不等于目录数据同步完成。

## 修复范围

- 增加受保护维护操作 `topic-plan`、`topic-apply`、`topic-verify`，复用权威投影、双指纹和事务核验逻辑。
- 计划是真正只读，不等同于旧同步 CLI 执行 DML 后回滚的 dry-run。
- 同步写入仅使用独立 `hzense_topic_sync`，不使用 Migrator 替代、不更改 ACL；保留当前 main／CI、运行绑定审批、备份和恢复证据要求。
- 检查未失效的历史核验依赖封印；非零时停止写入，写入前后封印总数变化也阻断事务。Apply 审批须明确 `publicationFreezeConfirmed: true`，维护期间暂停独立候选核验和 qualified publication，避免未审核的旧发布失效。
- 提交后独立连接验证完整投影，并确认没有剩余插入／更新；随后核对线上可用领域。
- 保留失败任务、费用和原配置，不缩小检索范围，不自动追加付费重试。

## 本地工具验证边界

提交前一轮定向回归为 2 个测试文件、413 项通过，包含新增的失败摘要脱敏与提交状态不确定性用例。该结果是当时的定向结果，不代表生产环境中已执行维护或通过同步验收；最终交付门禁以以下主干 CI 结果为准。

## 代码交付与生产准备

| 项目         | 本轮已核对结果                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR           | [#248](https://github.com/hzense/tech-intelligence-hub/pull/248)，已合并                                                                                                            |
| 当前主干提交 | `e2581af06c518b6bec5a8661bd7fa9025af2fabc`                                                                                                                                          |
| 主干 CI      | [41265488915](https://github.com/hzense/tech-intelligence-hub/actions/runs/41265488915)，三项作业全部成功                                                                           |
| 生产部署     | `dpl_3n8B2sWvFdsiBYMp5gVsNLLiPv1K`，Production READY，提交与当前主干一致                                                                                                            |
| 域名         | `hzense.com` 别名已核对指向上述部署                                                                                                                                                 |
| 本轮授权     | 已允许在备份与核验通过后升级 `0032`、配置既有 `hzense_topic_sync` 专用凭据并同步领域目录；维护冻结已确认                                                                            |
| 迁移前预检   | [41312427432](https://github.com/hzense/tech-intelligence-hub/actions/runs/41312427432)，绑定当前主干，经环境审批于 `2026-11-01T13:53:59.0602257Z` 成功，`pendingMigrationCount: 1` |

本轮授权不替代每个 GitHub 维护运行的环境审批。此预检只检查连接、迁移记录和待迁移数量，没有执行迁移、权限修改或 AI 调用。结构升级本身不创建角色、重放历史任务、发布信号或修改自动发布开关。

本次完整备份 `pre-topic-catalog-0032-20261101` 于 `2026-11-01T13:46:36Z` 创建，到期策略为 Never；其隔离子分支 `restore-check-topic-0032-20261101` 于 `2026-11-01T13:47:08Z` 创建，初始到期时间为 `2026-11-02T13:47:08Z`，恢复后核对的到期时间为 `2026-11-02T14:24:40Z`。备份强身份 SQL 已通过精确迁移账本与表集合断言（32 项迁移、58 张表），并核对可信 postmaster 身份设置及 owner 会话。未复用旧审批或旧恢复指纹；公开记录不包含原始分支 ID。

备份与隔离子分支的初始完整数据摘要一致，覆盖 58 张表、1,218 行；结构与 ACL 摘要分别覆盖 21 类，初始比对均一致。仅在隔离子分支提交了 canary 演练修改，三项结果断言均为 `true`。修改后的完整数据比对确认仅 `topics` 数据改变，其余 57 张业务表保持一致；该阶段完整证据已通过独立审核。这些写入发生在隔离演练副本，不是生产写入。

Neon 的 Reset 最终确认框明示操作不可撤销，因此先向用户请求了最终确认。收到确认后返回页面时，弹窗已经关闭，供应商显示更新时间为 `2026-11-01T14:24:41Z`；代理没有再次点击 Reset，不能声称由代理亲自执行了最终点击。随后通过新时间线和完整摘要实际核验恢复：隔离分支的 58 张表、1,218 行及全部数据／结构／ACL 摘要均与备份一致，canary 消失，演练中撤销的列权限已恢复。最终复查备份身份及数据／结构／ACL 均未改变。恢复核验已经通过，覆盖 44 个文件的最终证据清单已封存，SHA-256 为 `4ee06b19d0ed213014ecf58a0cc8b70c8c96a82580031f389bcc6f4d2b02fa2d`；清单独立审核已通过，44 个文件的大小和 SHA-256 全部一致。

新的只读 [ACL 双采样运行 41314482877](https://github.com/hzense/tech-intelligence-hub/actions/runs/41314482877) 经 GitHub 环境审批已成功；维护备份引用绑定本次新备份，运行绑定审批经过本地校验。两次采样时间为 `2026-11-01T14:25:34.912Z` 和 `2026-11-01T14:25:35.225Z`，结果一致，正式 ACL 指纹为 `09760ceb9b09f0514dde47633d0e3a3fb0aa54fbc03c691a802cbb1bc45c7399`。该采集审批建立时恢复验证尚未完成，因此如实保留 `restoreRehearsed: false`、`aclRecoveryReviewed: false`，没有填入虚构恢复指纹；它不是后续迁移的运行绑定审批。ACL 采集没有执行生产数据或权限写入。

正式 [迁移运行 41317293957](https://github.com/hzense/tech-intelligence-hub/actions/runs/41317293957) 精确绑定 `main@e2581af06c518b6bec5a8661bd7fa9025af2fabc`，经用户批准后已完成，工作流结果为 `completed`／`success`。本次运行绑定审批元数据通过纯函数校验及独立审核，于 `2026-11-01T14:41:23Z` 上传并回读确认更新时间；`Execute bounded maintenance` 在 `2026-11-01T14:48:45.4539246Z` 返回 `operation: migrate`、`status: succeeded`、`migrationCount: 33`、`tableCount: 58`。这是本轮生产结构写入，尚未执行 Topic 数据同步、AI 调用、开关或权限修改。

用户先确认保存专用 `HZENSE_TOPIC_SYNC_DATABASE_URL`，当时 GitHub Secret 元数据的更新时间为 `2026-11-01T14:47:50Z`；TLS 参数修正后，最新元数据更新时间已核对为 `2026-11-01T15:14:05Z`。这里只核对名称及更新时间，没有读取凭据值，也尚未证明该连接可成功认证。

独立只读 [topic-plan 运行 41318093575](https://github.com/hzense/tech-intelligence-hub/actions/runs/41318093575) 精确绑定同一主干提交，经审批于 `2026-11-01T15:05:21.7410678Z` 成功。该独立运行先执行 `verifyDatabaseContract` 完整 Schema 核验，确认 33 项迁移、58 张表，再生成 Topic 计划；因此无需另开一次重复的 `verify` 运行，迁移后的独立核验已完成。

计划为 0 项插入、42 项更新、20 项不变；当前 5 项启用，目标 47 项启用，10 个所需一级领域目前均未进入启用目录。核验依赖封印总数／未失效数为 0／0。报告中的 `roleExists` 仅证明专用角色存在，不代表凭据认证或完整最小权限预检通过。私有计划报告已保存并通过本地交叉核对，独立复审结果为 PASS，记录保存在私有 `topic-plan-independent-review.json`。以下四项指纹用于同步审批绑定：

| 指纹                    | 值                                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| `projectionFingerprint` | `f36edce0dd45602a29bf80c67068d93fe5f2d757bfd5b2e2dad7f277a5bf8b38` |
| `planFingerprint`       | `a3c1757e49fca1c8411f5e9bc8920f009c8604a7362b8ce11ac054afa76a60ab` |
| `manifestFingerprint`   | `20fcc247a55deaa9ca547cb2d6394a739fe3a851c6a682cd27eb47b62e61213d` |
| `targetFingerprint`     | `e9230d5ca7fa99779839d20fb025e3ca370179c579aeb1c385b6840f7f7aee93` |

随后检查发现，此前给用户的连接模板误用了 `sslmode=require`，而项目连接校验强制要求 `sslmode=verify-full`。已纠正模板，用户已确认修正并保存，无需重设密码；未读取 Secret 值，也没有通过关闭证书校验规避要求。实际专用连接认证及最小权限仍须由维护执行器验证。

正式 [topic-apply 运行 41320254050](https://github.com/hzense/tech-intelligence-hub/actions/runs/41320254050) 精确绑定 `main@e2581af06c518b6bec5a8661bd7fa9025af2fabc`。私有审批文件 `topic-apply-41320254050-approval.json` 绑定以上四项指纹、本次恢复证据及备份，明确 `publicationFreezeConfirmed: true`，通过 `validateMaintenanceRequest` 纯函数校验；`MAINTENANCE_APPROVAL` 元数据于 `2026-11-01T15:15:41Z` 更新并核对。用户已批准本次环境运行，运行于 `15:16:11Z` 开始，但最终失败，在 `2026-11-01T15:16:40.206Z` 返回：

```json
{
  "status": "blocked",
  "gate": "unavailable",
  "operation": "topic-apply",
  "topicSyncMayHaveCommitted": false,
  "verificationCompleted": false
}
```

本次正式同步未提交 Topic 数据，写后核验未完成。公开通用诊断不足以区分具体失败位置，不能据此认定专用连接认证或最小 ACL 预检已通过，也不能将 `roleExists` 作为替代证据。当前正在定位根因，没有盲目重跑或追加生产修改。

## 尚待完成

最小诊断补丁已通过 [PR #249](https://github.com/hzense/tech-intelligence-hub/pull/249) 合并为 `44a7aa96a9e94b3457f6b4099fa554758223175b`，定向回归 438 项、独立代码审核及主干 [CI 41322782146](https://github.com/hzense/tech-intelligence-hub/actions/runs/41322782146) 均通过。Vercel 生产部署 `dpl_92bgm6vhxZFk32zQE9hy9LcUu9wL` 为 READY，`hzense.com` 别名已核对指向该提交，本地已同步。固定白名单 `phase`／`reason` 不输出原始异常、SQL、连接串或动态对象名，原门禁和提交不确定性保持不变。

只读 [topic-verify 41323966645](https://github.com/hzense/tech-intelligence-hub/actions/runs/41323966645) 经用户审批，于 `2026-11-01T16:10:27.2303752Z` 返回 `blocked`／`unavailable`、`phase: dedicated-target`、`reason: unavailable`、`topicSyncMayHaveCommitted: false`、`verificationCompleted: false`。本次在专用连接地址的本地校验阶段停止，尚未执行数据库认证或权限预检，因此不能据此认定密码或权限有误。格式错误的具体字段尚未确认；正在补齐真实校验器错误分类并核对显式端口。本次没有生产数据写入或 AI 调用。

最初核对时 GitHub `production-maintenance` 环境缺少 `HZENSE_TOPIC_SYNC_DATABASE_URL`，现已由用户保存并确认修正 TLS 参数，仍待验证连接认证与最小权限。已通过 Neon Roles 页面确认 `main` 存在 `hzense_topic_sync`，本轮未新建、改密或授权。

补充诊断分类的本地回归 476 项及独立代码审核通过，使用真实连接校验器复现显式端口缺失、回环主机及库名／用户名非法百分号编码，并确认创建连接前停止。补丁尚未提交，校验规则未改变。用户随后确认连接确实缺少显式 `:5432`，已补齐并保存；Secret 元数据更新时间为 `2026-11-01T16:32:44Z`，未读取值。补正后的只读 [topic-verify 41326991812](https://github.com/hzense/tech-intelligence-hub/actions/runs/41326991812) 绑定 `main@44a7aa96a9e94b3457f6b4099fa554758223175b`，主干 CI 已成功，随后经用户本次环境审批执行，结果见下。端口缺失与已定位的校验错误吻合，仍须实际运行确认修正有效及后续认证、最小权限是否就绪。

端口补正后的运行已获审批并执行，于 `2026-11-01T16:34:41.4417606Z` 返回 `phase: dedicated-target`、`reason: connection-policy-invalid`，仍在认证或权限查询之前被地址校验阻止。当前日志没有具体字段，正在细分主机、端口、数据库名、账号和格式错误的固定原因码，保留严格校验和脱敏输出。本次没有数据库写入或 AI 调用。

1. 核对专用连接地址格式；修正并确认连接认证与最小权限后，重新核对计划及本轮维护绑定，不盲目重跑旧运行。
2. 按新的运行绑定审批执行 Topic 同步与独立核验，记录运行链接、审批绑定指纹、计数和 no-op 结果。
3. 核对线上发布目录与采集前置检查；真实采集结果以之后的正常计划或另行授权运行回执为准。

迁移后的独立完整 Schema 核验和 Topic 计划已通过，尚无 Topic 同步／写后核验成功回执；计划不会写入目录数据，不能宣称自动采集已经恢复。本文不包含数据库连接串、密码、Token 或原始日志导出。
