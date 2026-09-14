# AI 配置批次 ACL 采集审核（2026-09-14）

## 结论

两份迁移前 ACL 基线已完成独立重建、完整性与脱敏审核，目录指纹一致；真实附件原样归档为 [baseline.json](baseline.json)。本记录不是恢复 SQL 审核、隔离恢复演练或 AI 角色已授权的证明。

## 来源与绑定

- 来源：[Production maintenance #34794203356](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794203356)，operation `acl-capture`，attempt `1`，结果成功。
- 执行提交：`5a03b1e39f90a0e4ccdfb67979169f2a5233e73a`，由 [PR #80](https://github.com/hzense/tech-intelligence-hub/pull/80) 交付；[对应 main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34793904068) 成功。
- 线上附件名称：`acl-evidence-34794203356-1`；提取原文件后改名为 `baseline.json`，未改写正文。
- 归档 JSON 文件 SHA-256：`ce30d8eefdb7187c995189acf687f48d8eba56370524aab9dfb2c75208212b40`。这是文件字节摘要，不是 GitHub 压缩附件摘要或目录基线指纹。
- 附件记录的本次审批摘要 `riskAcceptanceSha256`：`3fb1d1a9a0f8d434f48e18b26f87eedc0a99c6b396387d7068cbcc08b7423be5`；原始审批和备份 ID 不在公开材料中。

先前 [#34794132133](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794132133) 因审批遗漏 `backupPresenceReviewed` 在连接数据库前被阻断，没有产生可用基线。上述成功采集使用新 run 及独立审批，不能把先前失败记录标为成功。

## 重建与身份核对

两次采集时间分别为 `2026-09-14T00:56:13.386Z` 和 `2026-09-14T00:56:15.161Z`。两个独立只读连接都记录：数据库 `hzense`，session／current user／database owner 为 `hzense_migrator`，PostgreSQL `180006`（18.6），隔离级别 `repeatable read`，`transactionReadOnly: true`。

使用共享 `buildRuntimeAclBaseline` 从各自身份、11 类目录记录、采集时间及已有备份引用重新构建，结果与归档的两份内层基线一致。两份目录指纹均为：

`d0ec28b658faf111413b82cab5447787d4d7edfaf653cd486a27f7726493e100`

仓库、执行 SHA、run／attempt、格式、风险状态和独立采集一致标志已核对；归档前完成脱敏审核。文件摘要、审批摘要与目录指纹各自绑定不同对象，不能互相替代。采集是 catalog-only，没有业务行或数据库转储，也没有执行授权或恢复 SQL。

## 备份与风险边界

操作者已核对新的生产 main 分支备份存在、目标正确、七天保留期覆盖本次维护，并明确接受恢复未演练风险。相关时间与后续检查见[本批生产记录](../../2026-09-14-ai-configuration.md#本次批准及备份)。备份存在不等于恢复成功，历史 ACL 缺口也没有由新采集倒推补齐。

附件明确记录 `recoveryPolicy: "accept-unverified-ai-config"`、`recoveryVerified: false`、`restoration: "unverified-risk-accepted"`；每份内层基线仍为 `restoration: "manual-review-required"`、`providerApiVerified: false`、`executableSqlIncluded: false`。这些声明与执行结果一致，没有将备份存在性或绿色 CI 当作恢复通过证明。

## 后续执行与适用范围

本基线是迁移和新增 AI 角色前的 ACL 状态，不是未来授权完成后的状态。它已绑定后续独立 [migrate #34794365453](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794365453) 的本批审批；该迁移成功，独立 [verify #34794509473](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794509473) 也成功，均为 14 个迁移／40 张表。

AI 角色及两个 Production Secret 尚未创建配置。未来最小授权仍须单独执行及复核，不能重用采集审批代替授权。当前未扩大 Runtime 权限、未配置 Publisher、未切换 Signal 新读取、未启用自动发布或采集任务，也未调用真实供应商。

本目录没有 `restore.sql` 或演练通过记录；不得据此执行恢复、destructive ACL normalization 或重跑已经完成的迁移。
