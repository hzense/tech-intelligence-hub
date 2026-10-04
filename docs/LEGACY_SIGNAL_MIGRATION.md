# 历史 Seed Signal 迁入数据库

本批把冻结的 110 条历史信号及其原始资料保存到 `legacy_signal_archive`，公开投影通过
`legacy_public_signals` 读取。保持原 ID、URL、事件日期、采集日期、评分、来源、专题和
实体引用；缺失人物、组织、来源和已移除的 `strength` 不补造。发表依据仍为
`legacy_seed`、状态仍为 `archive`，不会创建 AI 任务或赋予证据合格发表资格。
现有 AI 候选、人工发布及撤回历史不改动。

本文说明维护能力和执行门禁，不代表生产已迁移。生产结果须另附精确提交、Actions
运行、独立核验及正式域名验收证据。

## 固定维护操作

| 操作                    | 行为                                                                                                                                                  | 写入 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `legacy-signal-dry-run` | 两个独立生产目标校验连接，分别采集 ACL；对比内容、目标、备份、完整清单和 pending 计划，输出摘要                                                       | 无   |
| `legacy-signal-apply`   | 获取现有迁移 advisory lock，重验计划和 ACL；一个事务内执行 0028、登记 ledger、导入完整 110 条及授权公开视图三列；提交后独立完整 schema 和逐条档案核验 | 有   |
| `legacy-signal-verify`  | 独立完整 schema、冻结 110 条全部原始资料／引用／投影摘要及现有 reader 权限核验                                                                        | 无   |

仅允许当前 `main` 的人工 dispatch，仍使用既有 `production-maintenance` Environment。
依赖安装和构建不接收生产凭据。执行入口及每次新连接前检查当前 main 与最新成功 main CI，
写事务开始前和 COMMIT 前再次核验 main、CI 和审批有效期。GitHub 与数据库并非原子系统，
维护期间仍冻结 DDL、ACL、部署及 Seed 变更。

本次仅接受既有 0000–0027 全部正确应用且唯一 pending 为
`0028_legacy_signal_archive.sql`。历史清单摘要固定，0028 的 SQL 字节和全部清单绑定到
审批指纹。原始内容和公开投影还须匹配仓库中冻结的 110 条清单，不能临时换入另一批 Seed。
已完成迁移的数据库不能重放 apply；使用 verify 检查实际结果。

新增权限仅为现有 `hzense_editorial_reader` 对 `legacy_public_signals` 的
`SELECT(signal_id,content,content_hash)`。不会创建账号、增加角色成员或授予私有原始表
读取权限。写入前检查 reader 角色，授权后核对三列可读、私有表及公开视图的写权限仍被拒绝。

## 执行顺序

1. 评审合并实现并确认精确 main CI 成功，先部署兼容新增视图权限的 reader 检查器，
   但保留 YAML 读取模式。核验当前公开页面和数据库健康。
2. 在 Neon 创建覆盖当前生产状态的真实备份并核对目标及保留期；复核真实隔离恢复证据。
   当前备份引用保存到既有受保护 `MAINTENANCE_BACKUP_ID`。旧批准不得复用。
3. 冻结维护窗口，运行 dry-run，保存公开的清单、内容、目标、备份、计划和双采集 ACL 摘要。
   完整 ACL 仅在 runner 内存中比较，不输出 catalog 或上传业务行。
4. 创建新的 apply 运行。在 Environment 审批前，保存以下新 run-bound 审批。
   只有核对真实材料后才能把各声明置为 true。默认或显式 `recoveryPolicy=verified`；
   不支持借用旧批次的未验证风险接受策略。
5. 审批后单次事务提交。只有独立 schema 检查和逐条内容／权限核验均通过，任务才报告成功。
6. 另运行 verify，再切换历史信号读取配置为数据库。核对 110 个稳定 ID／URL、总数、
   来源、人物、组织和专题显示，并确认 2 条既有人工公开信号及其修订记录保留。
   实际人工公开数量若已变化，使用维护前后实时对账，不用文档数字覆盖现状。

批准结构示例（占位符不可执行）：

```json
{
  "operation": "legacy-signal-apply",
  "sha": "本次main完整SHA",
  "runId": "本次运行编号",
  "runAttempt": "1",
  "expiresAt": "未来最多24小时的真实UTC时间",
  "backupExpiresAt": "晚于审批到期的真实备份到期时间",
  "backupIdSha256": "dry-run结果",
  "recoveryPolicy": "verified",
  "backupVerified": true,
  "restoreRehearsed": true,
  "aclRecoveryReviewed": true,
  "ddlFreezeConfirmed": true,
  "restoreEvidenceFingerprint": "经审核真实恢复证据摘要",
  "aclFingerprint": "本次dry-run双采集摘要",
  "manifestFingerprint": "dry-run结果",
  "contentFingerprint": "dry-run结果",
  "targetFingerprint": "dry-run结果",
  "planFingerprint": "dry-run结果",
  "roleUpgradeApproved": true
}
```

真实备份无自动到期时，删除 `backupExpiresAt`、改为 `backupNeverExpires: true`；
二者互斥。真实恢复证据摘要与本次 ACL 摘要是不同材料，不能互相代替。
Environment 审批记录与 run-bound JSON 共同构成审核轨迹；布尔字段不自动证明外部事实。

## 失败与回退

事务内任一步失败均回滚同一连接中的 schema、ledger、数据和授权，不自动重试。
COMMIT 返回未知结果或提交后核验失败一律报告失败，并标记可能已提交；保持维护冻结，
先运行只读 verify，不能据失败状态再次重放迁移或删表。

应用读切换后如需回退，可恢复 YAML 读取模式；仓库原始 YAML 本批保留，数据库档案保持
追加保护，禁止 UPDATE、DELETE、TRUNCATE。回退读取不销毁数据，也不撤销既有 AI 修订。
需要数据库恢复时另外制定当前目标和恢复点计划，不能把本维护入口当作任意恢复 SQL。
