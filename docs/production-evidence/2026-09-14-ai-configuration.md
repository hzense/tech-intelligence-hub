# AI 配置生产迁移与启用检查（2026-09-14）

## 当前结论

生产数据库已完成 `0004–0013` 迁移，迁移后核验及独立 `verify` 均确认 14 个迁移、40 张表；AI 配置页面代码和域名白名单已部署生效。专用角色、数据库 URL 与根密钥环仍未创建配置，后台表单继续禁用。本记录不是 AI 服务可用或模型调用成功的验收证明，恢复能力仍未演练。

## 初次检查（迁移前历史）

- [PR #79](https://github.com/hzense/tech-intelligence-hub/pull/79) 已合并，提交 `3a71c1512398d433f7078fc2b7c9380c5f38212e`。
- 对应 [main CI #34787055330](https://github.com/hzense/tech-intelligence-hub/actions/runs/34787055330) 成功。
- Production 部署 `dpl_7Bn8S2p4mpWCLX5WtNYmm9fk4sQN` 为 READY，绑定 `hzense.com`，对应上述提交。
- 管理员浏览器已登录，`/admin/ai` 显示“AI 后台尚未配置完成”和“允许的接口域名：未配置”，表单禁用。
- 初次核对 Vercel Project 的 All Environments 列表时，未配置 `HZENSE_AI_DATABASE_URL`、`HZENSE_AI_KEYRING`、`HZENSE_AI_ALLOWED_HOSTS`；只核对名称和环境范围，没有读取现有 Secret 值。
- 随后已通过 Vercel 页面保存 Production-only Config `HZENSE_AI_ALLOWED_HOSTS=ai-gateway.vercel.sh`，成功提示及环境范围已核对。该时点尚未重新部署，后续部署及白名单生效结果见下文；专用数据库 URL／根密钥环仍未保存。

## Neon 迁移前只读核验

在现有生产项目的 `main` 分支、`hzense` 数据库执行 `BEGIN READ ONLY`，结束 `ROLLBACK`；没有写数据、修改 ACL 或密码。

| 检查         | 结果                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| 实际身份     | `hzense_migrator`                                                                 |
| PostgreSQL   | `18.6`                                                                            |
| 迁移账本     | `0000–0003` 共 4 条，checksum 与当前仓库一致                                      |
| AI 表        | 0 张                                                                              |
| AI 专用角色  | `hzense_ai_admin` 不存在                                                          |
| 现有连接限制 | Migrator 10，Runtime 20，未修改                                                   |
| 其他库       | `neondb` 没有 PUBLIC 数据库授权；`postgres`／`template1` 符合既有 Neon 保留库边界 |

独立的 [hosted preflight #34792736107](https://github.com/hzense/tech-intelligence-hub/actions/runs/34792736107) 在同一 main SHA 通过 Environment 审批后成功，最终输出 `pendingMigrationCount: 10`。它是只读预检，不是迁移或授权。

## 本次批准及备份

操作者已明确同意：保留新的生产备份，接受恢复能力尚未演练的风险，升级 `0004–0013` 并授权仅访问五张 AI 私表的专用角色；不启用 Signal 自动发布、不切换网站数据源。此同意不伪装成恢复验证证明。

Neon 已创建 `pre-ai-config-20260914`，选择当前 `main` 的 **Branch data and schema**，自动删除设为七天。创建结果页确认 parent 为生产 main、创建时间 `2026-09-14 02:30:11 GMT+2`、到期 `2026-09-21 02:30:10 GMT+2`。真实分支 ID 仅用于受保护审批绑定；本记录不公开连接串。分支存在、目标及期限已核对，但没有执行恢复演练，`backupVerified`／`restoreRehearsed`／`aclRecoveryReviewed` 仍为 false。

提交前本地验证：整仓单元测试、lint、类型、格式及工作流校验通过；完整原生 PostgreSQL 集成 469 项通过，包含 AI 角色 77 项及实际迁移 SQL 快照绑定回归；配置组件→HTTP→真实受限 PostgreSQL 浏览器回归 7 项通过。迁移门禁与 ACL 由独立代理只读复核，无剩余确定阻断项。一次性本地夹具结束后已恢复其保留库 PUBLIC 有效权限、临时数据库及角色零残留；没有修改历史本地开发库或生产 ACL。这些本地结果与下述实际线上执行分开记录。

## 批次代码、部署与预检

- [PR #80](https://github.com/hzense/tech-intelligence-hub/pull/80) 已合并为 `5a03b1e39f90a0e4ccdfb67979169f2a5233e73a`，[同 SHA main CI #34793904068](https://github.com/hzense/tech-intelligence-hub/actions/runs/34793904068) 成功。
- Production 部署 `dpl_F4FUpDLQVPMtwSwKVACvW1zFRDvF` 为 READY，绑定 `hzense.com`，对应上述提交。
- 重新通过真实 Google 管理员登录访问 `/admin/ai`，确认允许域名已显示且白名单生效；后台仍提示未配置完成，表单禁用，没有调用供应商。
- 新的 [preflight #34794059431](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794059431) 成功，输出 `pendingMigrationCount: 10`，用于审核该 SHA 的精确迁移计划。

本次审批绑定的指纹：

| 范围                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| 固定迁移工件 `manifestFingerprint`   | `821f317947c6c0234a7e16caf10423a5431e791a228cc752a81fac33b6aa2654` |
| 本次十项待执行计划 `planFingerprint` | `444fc7540b0fc9a36650ed6415d742c8d04e0ba7e49344860862d4f9074b3893` |
| 迁移前双采集 ACL 基线                | `d0ec28b658faf111413b82cab5447787d4d7edfaf653cd486a27f7726493e100` |

它们标识不同对象，不是备份可恢复或服务已可用的证明。完整审批及原始备份 ID 仅保存在受保护环境中。

## ACL 双采集及审核

首次 [acl-capture #34794132133](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794132133) 因审批遗漏 `backupPresenceReviewed`，在连接数据库前被门禁拒绝；没有产生成功基线或数据库写入。补齐真实备份存在性声明后，使用新的运行及独立审批，不复用失败 run。

[acl-capture #34794203356](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794203356)，attempt `1`，成功完成。原始附件归档为 [baseline.json](acl/34794203356-1/baseline.json)，两份内层基线重建、执行身份、SHA／run／attempt、指纹及脱敏检查通过；11 类目录一致，均得到上表 ACL 指纹。详细来源、文件摘要和残余限制见[审核记录](acl/34794203356-1/review.md)。附件明确记录 `accept-unverified-ai-config`、`recoveryVerified: false`，没有恢复 SQL 或演练通过结论。

## 生产迁移与独立核验

| 运行                                                                                                       | 结果与边界                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [migrate #34794365453](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794365453)           | 成功应用 `0004–0013`，迁移内最终 Schema 核验为 `migrationCount: 14`、`tableCount: 40`；返回的 manifest／plan 指纹与预检一致，恢复状态仍为未验证。 |
| [verify #34794509473](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794509473)            | 独立只读运行成功，输出 `migrationCount: 14`、`tableCount: 40`，不是仅依据迁移任务成功推定。                                                       |
| [runtime-preflight #34794586203](https://github.com/hzense/tech-intelligence-hub/actions/runs/34794586203) | 使用 Runtime 自身凭据独立只读预检成功，最终为 `operation: runtime-preflight`、`status: succeeded`；未扩大其既有权限。                             |

迁移后公开数据库健康端点 `/api/health/database` 实测 HTTP `200`、精确正文 `{"status":"ok"}`。这证明该次健康探针成功，不能替代完整 Runtime 最小权限核验或 AI 专用连接验收。

本批使用独立 `accept-unverified-ai-config` 策略及精确 run-bound 审批。迁移器在持锁后校验真正执行的冻结 SQL 工件及计划，不复用 FTS-1 豁免；逐文件事务不是整批原子事务。本次成功结果不授权未来迁移或再次重放已完成的空计划。

## 待执行边界

上述生产维护运行均已结束，没有仍在执行的数据库任务。剩余工作：

1. 管理员创建空的受限 AI 登录角色，再由数据库 owner 执行已审核的固定授权 SQL 并独立复核；不扩权 Runtime，不授权 Publisher，不修改其他库／PUBLIC 权限。
2. 仅在 Vercel Production 保存 AI 专用连接和根密钥环，保留已生效的明确允许域名，再部署并进行真实管理员浏览器验收。凭据操作仍遵守浏览器确认／接管边界。
3. 后续授权前仍复核上述备份保留期及维护窗口；不将本批迁移成功当作恢复能力证明。

本轮不轮换既有凭据，不建立本地生产 `.env`，不触发付费模型测试。供应商 API Key 由管理员在可用页面中添加；页面可配置、连接可保存、真实模型能力测试以及 Profile 就绪分别验收。

Signal 新读取模式、自动发布和采集任务保持关闭。新增角色或根密钥不写入仓库，本文不保存密码、数据库连接串、Cookie、完整变量值或原始错误。
