# 生产自动采集领域目录核对

日期：2026-11-01。状态：根因已确认，受保护同步入口修改尚未上线；生产尚缺 `0032` 迁移，目录同步未完成。本轮未写生产、未调用付费 AI。

## 已确认的线上事实

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

随后在 Neon SQL Editor 执行只读核对，得到：

| 数据库核对项               | 结果                                          |
| -------------------------- | --------------------------------------------- |
| 当前数据库                 | `hzense`                                      |
| 登录角色                   | `session_user = hzense_migrator`              |
| 已登记迁移                 | 32 项，最新为 `0031_retire_unused_tables.sql` |
| Topic 总数／启用数         | 62／5                                         |
| 核验依赖封印总数／未失效数 | 0／0                                          |

这些是只读快照，不代表已完成完整 Schema／角色 ACL 核验或可沿用到未来写入。当前仓库需要 33 项迁移，尚缺 `0032_automatic_signal_publication.sql`；`topic-plan`、`topic-apply`、`topic-verify` 均要求完整 Schema，会被该待迁移项阻断。

执行器在调用发现模型前比较所选领域与 `editorialTopicOptions()`。生产发布启用时，后者读取 `topics` 中 `runtime_enabled=true` 且未归档的条目。任一所需领域缺失即停止，任务保留零费用。此次故障发生于该检查；代码部署已完成，不等于目录数据同步完成。

## 修复范围

- 增加受保护维护操作 `topic-plan`、`topic-apply`、`topic-verify`，复用权威投影、双指纹和事务核验逻辑。
- 计划是真正只读，不等同于旧同步 CLI 执行 DML 后回滚的 dry-run。
- 同步写入仅使用独立 `hzense_topic_sync`，不使用 Migrator 替代、不更改 ACL；保留当前 main／CI、运行绑定审批、备份和恢复证据要求。
- 检查未失效的历史核验依赖封印；非零时停止写入，写入前后封印总数变化也阻断事务。Apply 审批须明确 `publicationFreezeConfirmed: true`，维护期间暂停独立候选核验和 qualified publication，避免未审核的旧发布失效。
- 提交后独立连接验证完整投影，并确认没有剩余插入／更新；随后核对线上可用领域。
- 保留失败任务、费用和原配置，不缩小检索范围，不自动追加付费重试。

## 本地工具验证边界

最新定向回归为 2 个测试文件、413 项通过，包含新增的失败摘要脱敏与提交状态不确定性用例。该结果不代表修改后重新运行了全部套件，也不代表生产环境中已执行维护或通过同步验收。本文四份关联文档通过 Prettier 与 `git diff --check`。

## 尚待完成

核对时 GitHub `production-maintenance` 环境仅有已有维护／运行时连接与维护审批秘密，尚无 `HZENSE_TOPIC_SYNC_DATABASE_URL`；此处仅核对变量名称，未读取或记录凭据。随后通过已登录的 Neon Roles 页面确认 `main` 已存在 `hzense_topic_sync`，未新建、改密或授权。

1. 完成代码评审、CI、合并和维护入口上线。
2. 取得本轮 `0032` 生产写入授权，按标准受保护流程准备备份、执行迁移并独立核验。该迁移仅准备自动发布能力所需结构，不包含角色授权、历史任务重放、信号发布或开关修改；本轮尚未获准或执行。
3. 迁移就绪后执行受保护的只读 `topic-plan`，确认实际插入／更新范围、目标、Schema、专用角色状态及依赖封印数量。
4. 确认专用凭据与最小权限就绪，准备本次有效备份、恢复证据和运行绑定审批。
5. 执行同步与独立核验，记录运行链接、审批绑定指纹、计数和 no-op 结果。
6. 核对线上发布目录与采集前置检查；真实采集结果以之后的正常计划或另行授权运行回执为准。

当前没有生产计划／同步／核验成功回执，本地维护工具测试也不计为生产验收，不能宣称自动采集已经恢复。本文不包含数据库连接串、密码、Token 或原始日志导出。
