# 自动化配置删除启用记录

日期：2026-10-02（Europe/Berlin）。本记录不包含凭据、完整连接串、原始生产目标或备份 ID。

## 当前结论

**配置删除已启用，专用测试配置的保存、刷新读回、软删除及再次刷新验收通过。**
[PR #187](https://github.com/hzense/tech-intelligence-hub/pull/187) 已评审合并，新的受保护
[维护运行 37026577164](https://github.com/hzense/tech-intelligence-hub/actions/runs/37026577164)
在当次人工审批后成功完成 `0027`、独立完整核验和固定最小增量授权。
仅软删除一条本次新建、未启用的验收配置；原有两条配置保持不变，页面无新增运行记录。
采集执行仍关闭，未调用 AI、改动凭据或删除既有业务配置。恢复能力仍未演练，
新备份及本次风险接受不构成恢复验证。

## 已确认基线

- [PR #186](https://github.com/hzense/tech-intelligence-hub/pull/186) 已评审合并至
  `10df12b1883c296550481183bdfd6fe8d3a1c58e`，PR 与 main CI 通过，本地 main 已同步。
- 对应 Vercel Production 为 Ready，提交与正式域名 `hzense.com` 绑定已核对。
  两个配置页可读取；短窗口错误扫描未见异常，不等于长期监控或删除验收通过。
- 生产前一批已完成 `0026`：27 项迁移／60 张表，配置管理专用角色精确 82 项列能力，
  一条未启用配置的保存／刷新读回成功，采集执行仍关闭。依据见
  [原存储验收记录](2026-10-01-automation-storage.md)，不把其旧审批复用于本次升级。
- PR #186 的兼容代码在未执行 `0027` 时继续支持原读取／保存，删除保持未就绪；
  新列存在但增量 ACL 未完成时拒绝操作，不能回退到旧权限模式绕过核验。

### 本批新备份

- 经 Neon Console 新建独立 main 数据与 Schema 备份，界面确认创建成功。
  创建时间 `2026-10-02T14:09:01Z`，保留至 `2026-10-09T14:08:59Z`。
- 公开只记录备份引用 SHA-256：
  `0ddaba34252c8e56942c18dda42225400f29b201384f271a5bbfe5bd7521521a`。
  原始引用仅用于受保护绑定，不写入仓库、日志或聊天。
- 本次备份已绑定新运行及当次批准，维护冻结与预期目标已确认；批准期限早于真实备份到期。
  未执行恢复演练，`recoveryVerified` 仍为 `false`。

## 本次独立批准范围

采用 `migrate-and-verify` 的独立策略 `accept-unverified-automation-config-deletion`，
范围 `automation-config-deletion-production-launch`。完整冻结清单为 `0000–0027`
共 28 项，只接受唯一待迁移 `0027_automation_config_deletion.sql`；旧 `0026`
策略及冻结清单保持原样。详细操作见[维护规程](../ONLINE_MAINTENANCE.md#0027-配置删除单次审批维护)。

- 新备份、保留期限、维护冻结、SHA、run／attempt、有效期、目标／清单／计划摘要以及
  同 run ACL 脱敏公开归档均须由新审批绑定，不填写伪造恢复证据。
- 同一受保护 job：prepare（只读 preflight → ACL 独立双采集及安全落盘）→ 远端附件归档
  成功 → apply（迁移 → 独立完整 verify → 固定最小增量授权）。不增加阶段重复审批，
  也不自动批准后续运行；归档失败不执行 DDL。
- 审批必须包含 `roleUpgradeApproved: true`，并将 `roleUpgradeSha256` 绑定为
  `3372dcc11b59e8747589cf34f016a030c08f454a961b1d8a96a315e08d01bde2`。
  对应固定文件为 `db/roles/upgrade_automation_config_deletion.sql`，不接受任意 SQL。
- 增量仅为配置删除时间列的 `SELECT`／`UPDATE`，专用角色能力从 82 项到 84 项；
  不增加角色、密码、表级权限、转授权或其他表能力。独立 verify 预期 28 项迁移／60 张表。
- 保留所有现有配置、运行历史、结果、费用及公开报告；不改凭据、不开采集／定时执行，
  不调用 AI。验收只允许新建的一条未启用专用测试配置被软删除。

## 交付与受保护执行结果

- PR #187 复审修复了两种持锁连接的空闲断线处理，最终评审及 CI 通过后合并为
  `d460a3cacad111348eb4338ee68ba80bfb950cad`；对应
  [main CI 37025889536](https://github.com/hzense/tech-intelligence-hub/actions/runs/37025889536)
  成功。首轮 CI 不是本次最终交付依据。
- 本次运行 `37026577164`／attempt `1` 绑定该 SHA、新备份和独立删除策略，经新的
  `production-maintenance` Environment 审批执行；未复用旧 `0026` 批准。
- 同 run prepare 只读预检确认 `pendingMigrationCount: 1`，ACL 独立双采集及远端
  附件归档成功后进入 apply。冻结清单只允许待迁移 `0027`，没有捎带其他升级。
- migrate 与独立 verify 均成功，结果为 **28 项迁移／60 张表**；固定角色升级完成，
  最终 `verificationCompleted: true`、`roleUpgradeCompleted: true`、
  `pendingMigrationCount: 0`。运行于 `2026-10-02T15:37:39Z` 成功结束。
- 角色增量仅为 `automation_configs.deleted_at` 的 `SELECT`／`UPDATE`，
  精确列能力由 82 项增至 84 项；没有增加表级删除权限、创建角色或修改密码。

### 同 run ACL 归档回执

- 附件：[`acl-evidence-37026577164-1`](https://github.com/hzense/tech-intelligence-hub/actions/runs/37026577164/artifacts/11235748147)，
  artifact ID `11235748147`，大小 38,578 字节。
- 到期时间：`2026-11-01T15:37:22Z`。这是附件保留期限，不是 Neon 备份期限。
- GitHub 附件摘要 SHA-256：
  `ad0245f6dbd8ef9b0628a3c2c3395250f676bbfafefa7160d64928bb0afa8ad3`。
- 本记录核对了工作流归档步骤及附件元数据；不把附件存在称为恢复演练或恢复 SQL 已验证。

## 实际页面与有界删除验收

自动采集页显示配置存储就绪，实际专用角色通过应用的完整权限守卫，删除按钮可用。
专题洞察页 `/admin/topics` 同样显示“配置存储已就绪：可以保存配置”，配置与运行记录为空，
执行及定时不可用；本次没有新建专题测试配置。正式域名 `hzense.com` 的部署查询确认
`dpl_62bJ7WnNYtnFzCutkFy719mAqgkW` 为 Ready／Production、SHA 为上述 `d460a3c…`，
别名包含 `hzense.com` 与 `www.hzense.com`。`/api/health/database` 返回 `status: ok`；
该部署 Production 近 10 分钟 error／fatal 扫描没有记录，不代表长期无错误。

本次仅使用一条专用测试配置“删除验收 2026-10-02（未启用测试）”：

1. 按手动频率、未启用状态保存为 r1，不执行计划或调用所选模型。
2. 整页刷新后读回同一条配置，确认保存已持久化。
3. 确认软删除，页面明确提示“配置已删除，后续调度已停止；历史任务、结果和费用记录保留”。
4. 再次整页刷新，测试配置从列表消失；原有两条配置及其 r1／r3 修订不变，运行列表仍无记录。

首次浏览器确认操作曾遇到连接超时；先用只读页面确认测试配置尚在，再继续操作同一条记录，
没有重复新建测试配置或因未知结果自动重发。实际删除为软删除，保留配置行及审计关联，
没有删除原有配置、运行历史、结果、费用或公开报告。
本次没有逐行核验费用表；“无新增运行记录、未调用 AI”依据页面读回与实际操作范围，
不将其扩大为全库费用逐行一致性证明。上述角色、两个页面及有界验收通过后，本次维护窗口结束。

## 失败与验收边界

迁移、独立核验和角色升级不是一个跨步骤原子事务。迁移后的失败可能已提交 `0027`，
并因 ACL 尚未齐全暂时阻断配置存储。此时保持 DDL／授权／发布冻结，先只读核对状态，
不自动重试、回滚、执行恢复 SQL、改密码或放宽权限。续接必须依据真实状态重新批准。

固定授权脚本成功不替代完整角色核验，Production Ready 不等于删除可用。维护冻结须保持
至真实角色及页面读回通过；验收中的未知提交不自动重发，先查询状态，不重复新建配置。
恢复能力仍未演练，风险接受不改变这一事实。
