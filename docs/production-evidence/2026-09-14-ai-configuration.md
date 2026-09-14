# AI 配置生产准备（2026-09-14）

## 当前结论

AI 配置页面代码已上线，但后端未启用；此记录不是 AI 服务可用或模型调用成功的验收证明。

- [PR #79](https://github.com/hzense/tech-intelligence-hub/pull/79) 已合并，提交 `3a71c1512398d433f7078fc2b7c9380c5f38212e`。
- 对应 [main CI #34787055330](https://github.com/hzense/tech-intelligence-hub/actions/runs/34787055330) 成功。
- Production 部署 `dpl_7Bn8S2p4mpWCLX5WtNYmm9fk4sQN` 为 READY，绑定 `hzense.com`，对应上述提交。
- 管理员浏览器已登录，`/admin/ai` 显示“AI 后台尚未配置完成”和“允许的接口域名：未配置”，表单禁用。
- 初次核对 Vercel Project 的 All Environments 列表时，未配置 `HZENSE_AI_DATABASE_URL`、`HZENSE_AI_KEYRING`、`HZENSE_AI_ALLOWED_HOSTS`；只核对名称和环境范围，没有读取现有 Secret 值。
- 随后已通过 Vercel 页面保存 Production-only Config `HZENSE_AI_ALLOWED_HOSTS=ai-gateway.vercel.sh`，成功提示及环境范围已核对。专用数据库 URL／根密钥环尚未保存，尚未重新部署，因此不能据此声明后台已可用。

## Neon 只读核验

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

最终本地验证：整仓单元测试、lint、类型、格式及工作流校验通过；完整原生 PostgreSQL 集成 469 项通过，包含 AI 角色 77 项及实际迁移 SQL 快照绑定回归；配置组件→HTTP→真实受限 PostgreSQL 浏览器回归 7 项通过。迁移门禁与 ACL 由独立代理只读复核，无剩余确定阻断项。一次性本地夹具结束后已恢复其保留库 PUBLIC 有效权限、临时数据库及角色零残留；没有修改历史本地开发库或生产 ACL。远端 CI、合并与生产升级仍须分别确认。

## 待执行边界

1. 完成跨库 PUBLIC 权限守卫的代码评审及 CI。
2. 使用上述已创建且核对的新备份；每次写审批前复核维护窗口、保留期与恢复尚未验证的风险。旧 FTS-1 风险豁免不覆盖 `0004–0013`。
3. 通过受保护且精确清单／计划绑定的路径按序升级 `0004–0013`，再独立核验 Schema；每文件独立事务，失败后先检查实际账本，不盲目重跑。
4. 管理员创建空的受限 AI 登录角色，再由数据库 owner 执行已审核的固定授权 SQL；不扩权 Runtime，不授权 Publisher，不修改其他库／PUBLIC 权限。
5. 仅在 Vercel Production 保存 AI 专用连接、根密钥环和明确允许域名，再部署并进行真实管理员浏览器验收。

本轮不轮换既有凭据，不建立本地生产 `.env`，不触发付费模型测试。供应商 API Key 由管理员在可用页面中添加；页面可配置、连接可保存、真实模型能力测试以及 Profile 就绪分别验收。

Signal 新读取模式、自动发布和采集任务保持关闭。新增角色或根密钥不写入仓库，本文不保存密码、数据库连接串、Cookie、完整变量值或原始错误。
