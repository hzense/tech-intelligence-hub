# 全线上生产维护

自 2026-09-07 起，操作者批准采用 GitHub Actions + Neon Console + Vercel
的全线上运维边界。无需安装本地运维 CLI、创建 `.env.fts1.local` 或在终端输入生产密码。
共享迁移、同步、权限检查代码及其 CI 测试继续保留，作为线上 runner 的实现。

## 当前落地状态

- GitHub Environment `production-maintenance` 已创建并通过 API 回读确认。
- 仅允许名为 `main` 的 **branch**，同名 tag 和其他分支不在允许范围内。
- 必须由 `zhenghu` 审批，禁止管理员绕过。允许发起人审批，适配当前单操作者流程；
  **这不是双人独立审批**，也不会自动审批。多人运维时应增加独立审核者并禁止自审。
- 八个非密码目标校验变量已配置；原有 `Production` / `Preview` 环境未改动。
- 基础工作流与测试已通过 [PR #47](https://github.com/hzense/tech-intelligence-hub/pull/47)
  合并为 `main@88b7570`，对应 [main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34121384366)
  已成功。这不等于生产维护已执行。
- 执行入口复核加固已通过 [PR #48](https://github.com/hzense/tech-intelligence-hub/pull/48)
  合并为 `main@333245f`，合并后 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34141929106)
  成功；2026-09-08 只读 preflight 已实跑成功，写操作尚未执行。
- 2026-09-08 操作者保存凭据后，回读确认两个连接 Secret 名称存在；未读取其值。
  只读 [preflight #34212653428](https://github.com/hzense/tech-intelligence-hub/actions/runs/34212653428)
  经操作者手动审批后成功，脱敏结果为 `pendingMigrationCount: 1`。
  Migrator 直连与预检合约已验证；Runtime Secret 尚未通过自身凭据实跑验证。
  操作者已知情批准将完整 ACL/恢复材料归档到当前公开仓库，不创建私有仓库。
  新增 `acl-capture` 的工作区实现尚未提交、合并或线上运行；备份恢复复核仍待完成，
  详见[当日门禁记录](./production-evidence/2026-09-08-fts1-gates.md)。

## 网页配置

进入仓库 [Environments 设置](https://github.com/hzense/tech-intelligence-hub/settings/environments)，
选择 `production-maintenance`，在 **Environment secrets** 添加现有值。
不要用 Repository secrets、普通 Variables、workflow inputs、Issue、聊天或提交文件传递凭据。

| Secret                        | 用途                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_DIRECT_URL`         | `hzense_migrator` 的生产 direct 连接，带显式端口，使用 `sslmode=verify-full`                                    |
| `HZENSE_RUNTIME_DATABASE_URL` | 现有 `hzense_runtime` pooler 连接，带显式端口，只使用 `sslmode=verify-full&channel_binding=prefer` 两个查询参数 |
| `MAINTENANCE_BACKUP_ID`       | 独立验证的恢复备份真实 ID，仅写操作及 `acl-capture` 注入                                                        |
| `MAINTENANCE_APPROVAL`        | 针对一次写操作或 ACL 公开采集的受保护 JSON 审核记录，格式见下文                                                 |

不重置或轮换现有密码。直连与 Runtime 凭据不会在一个执行步骤同时注入。
安装依赖、构建投影、检查源码及 CI 的步骤不接收生产凭据。

已配置的 Variables 为 `HZENSE_DATABASE_EXPECTED_HOST/PORT/NAME/USER/PGVECTOR_VERSION`
及 `HZENSE_RUNTIME_EXPECTED_HOST/PORT/NAME`。实际连接必须独立匹配这些目标，
不能根据待检 URL 自动推导期望身份来绕过检查。

## Actions 操作顺序

工作流经 PR 审核、合并，且该次 `main` push 的 CI 全部成功后：

1. 在 [Actions](https://github.com/hzense/tech-intelligence-hub/actions) 选择
   **Production maintenance → Run workflow → main**，每次只选一个 operation。
2. 任务停在 Environment 审批。核对 commit、operation、运行编号和尝试编号。
   写操作必须先完成恢复审核，并在审批前更新 `MAINTENANCE_APPROVAL`。
3. 审批后由 GitHub hosted runner 执行。若等待期间 `main` 前进或最新 push CI
   不是 success，初检失败，不进入持密执行步骤；需针对新的 `main` 重新发起、审核。
   新增的执行入口复核会在数据库模块加载前再次检查 main、最新 push CI，再回读 main，
   并重验写操作审批有效期。复核失败不会调用数据库代码。
4. 查看最终 JSON 和任务结论。公开输出仅保留计数、指纹和有界错误分类，
   不输出完整 catalog、文档 ID、URL、角色详情、备份 ID、原始错误或堆栈。
   失败时在 Neon 受控页面继续诊断，不开启原始数据库调试日志。

| operation           | 执行内容                                                 | 写数据库                 |
| ------------------- | -------------------------------------------------------- | ------------------------ |
| `preflight`         | direct 目标、TLS、版本和迁移历史检查                     | 否                       |
| `migrate`           | preflight → 校验清单中的迁移 → schema verify             | 是，需恢复审核           |
| `verify`            | preflight + 完整 schema 合约检查                         | 否                       |
| `search-dry-run`    | 检查迁移/schema 后计算回填计划，回滚事务                 | 不提交变更               |
| `search-apply`      | 加锁后重核投影/计划指纹，回填并验证无残留漂移            | 是，需恢复及计划审核     |
| `runtime-preflight` | Runtime 自身凭据的 TLS、跨库与最小权限检查               | 否                       |
| `acl-capture`       | 两个独立只读连接采集 ACL，一致后生成已授权的公开证据附件 | 否，需备份/冻结/公开授权 |

所有维护使用固定 concurrency group，不会自动取消正在执行的维护。
GitHub concurrency 不是持久 FIFO 队列，不要同时提交多次请求。
不要在迁移中手动 Cancel；多条迁移可能已部分提交，中断后先只读核验再决定重跑。
没有任意 SQL、任意 shell、任意 ref、自动 ACL normalization 或自动切换搜索的入口。

## 执行入口复核边界

复核仅使用 Node 内置 API 向固定的 `api.github.com` 仓库路径发起只读请求，
按 GitHub 官方 [Git reference](https://docs.github.com/en/rest/git/refs#get-a-reference)
及 [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)
接口检查返回的 ref、提交、仓库、工作流路径、触发事件、分支和执行状态。
不通过 `status=success` 筛选来跳过更新的失败或运行中记录。

执行步骤的 `GH_TOKEN` 来自已有只读 `github.token`，不要求新增个人 Token 或权限。
每次请求超时 10 秒，禁止重定向和缓存；缺少 Token、HTTP 错误、限流、超时、JSON 异常、
身份不匹配或无成功 CI 都会阻断。公开失败记录仅给出固定 gate 名，不输出 API 原始正文。
Token 不传给数据库执行函数，并在真实入口从 `process.env` 删除后才加载数据库依赖。

这项加固**缩小而非消除**检查与执行之间的时间窗：末次 main 回读后仍可能发生 Git 更新或
CI 重跑，GitHub 检查与数据库事务无法由此形成原子操作。维护期间的 DDL/发布冻结仍然必要。
审批有效期在数据库执行入口检查，不表示整个长事务内持续检查或到期自动回滚。
代码和依赖在同一 runner 上准备、执行的供应链风险也仍存在；仅拆 job、传递原有依赖
artifact 不能保证执行期恶意依赖无法读取生产凭据，后续须单独设计与验证该边界。

## 写操作恢复审核

原有 [FTS-1 上线顺序](./DEPLOYMENT.md#fts-1-数据库搜索上线顺序) 与
[ACL 恢复门禁](./DEPLOYMENT.md#runtime-acl-恢复基线) 不变。
先在 Neon 完成备份独立恢复验证、冻结 DDL、双重 ACL baseline 采集复核、
恢复方案审查及隔离演练，并处理历史证据缺口。备份必须覆盖当前目标和维护时间窗；
分支存在或行数一致不能代替恢复验证。

以下是 `MAINTENANCE_APPROVAL` 结构；占位符和 `false` **不能通过门禁**。
仅在审核真实证据后填写实际值，全部内容只保存在受保护 Secret 中。

```json
{
  "operation": "migrate",
  "sha": "本次运行的40位提交SHA",
  "runId": "运行编号字符串",
  "runAttempt": "尝试编号字符串",
  "expiresAt": "审核有效期ISO时间，未来且最多24小时",
  "backupExpiresAt": "备份真实过期ISO时间，晚于审核有效期",
  "backupIdSha256": "MAINTENANCE_BACKUP_ID原始UTF-8文本的SHA-256",
  "backupVerified": false,
  "restoreRehearsed": false,
  "aclRecoveryReviewed": false,
  "ddlFreezeConfirmed": false,
  "aclFingerprint": "两次独立采集且审核一致的64位小写SHA-256",
  "restoreEvidenceFingerprint": "受保护恢复演练证据的64位小写SHA-256"
}
```

`search-apply` 还需同一提交的 `search-dry-run` 输出中 `fingerprint` 和
`planFingerprint`，分别填入 `projectionFingerprint` 和 `planFingerprint`。
数据库状态改变导致计划不同，apply 拒绝执行。提交、operation、运行或尝试编号改变，
以及审核过期，均需重新审核；不要用 Re-run jobs 复用旧批准。

这些字段是审核声明和防误用门禁，**不是**程序自动验证 Neon 备份、恢复证据或人工审核真实性。
`backupIdSha256` 是未加域前缀的 ID 摘要，与 ACL 工具的域分隔 `backupReference` 不同，
不可混用；审批人必须核对受保护原件。摘要应在线上受控证据处理环节生成，不使用公开哈希网站。

## 当前仓库 ACL 公开归档

2026-09-08 操作者在获知当前仓库公开、角色关系/对象名称/详细权限和恢复脚本可能
被长期保留后，明确回答“允许”。本次归档位置为 `hzense/tech-intelligence-hub`，
不再要求新建私有仓库。范围见[归档约定](./production-evidence/acl/README.md)。
此决定只改变材料可见性，不表示备份验证、历史缺口接受或恢复演练已完成。

新增入口须先经过 PR 审核、合并及 main CI。之后独立验证本次 provider 备份并冻结 DDL，
发起 `acl-capture`，在人工审批前将 `MAINTENANCE_APPROVAL` 更新为以下实际记录：

```json
{
  "operation": "acl-capture",
  "sha": "本次运行的40位提交SHA",
  "runId": "运行编号字符串",
  "runAttempt": "尝试编号字符串",
  "expiresAt": "审核有效期ISO时间，未来且最多24小时",
  "backupExpiresAt": "备份真实过期ISO时间，晚于审核有效期",
  "backupIdSha256": "MAINTENANCE_BACKUP_ID原始UTF-8文本的SHA-256",
  "backupVerified": false,
  "ddlFreezeConfirmed": false,
  "publicArchiveApproved": true,
  "archiveRepository": "hzense/tech-intelligence-hub"
}
```

占位符和 `false` 不能通过。采集不要求预先声称 ACL 恢复演练已完成，避免循环依赖；
但 `migrate` / `search-apply` 的完整恢复门禁保持不变，不接受采集审批冒充写操作审批。
两次独立采集各自只读并关闭连接，重建校验指纹且比较一致；开始、两次采集之间及写出
证据文件前重验审批。发现不一致或失败时不归档部分结果。

公开日志仍仅包含摘要。唯一允许的附件文件为 hosted runner 临时目录中的
`hzense-acl-evidence.json`，附件名 `acl-evidence-<runId>-<runAttempt>`，保留 30 天。
该文件不是数据库备份：仅包含两份 catalog 基线和运行标识，不包含业务行或原始备份 ID。
归档步骤不注入生产凭据；不上传目录、配置文件或任意路径，不自动向 main 写入文件。
附件应视为公开材料。审核并在过期前通过 GitHub 网页将其归档到
`docs/production-evidence/acl/<runId>-<runAttempt>/baseline.json`，经 PR 复核后合并；
未完成此步不得称为“代码仓永久归档已完成”。无需本地密码配置或本地采集工具。

附件审查应核对来源 run/attempt/SHA、两份基线及分类指纹、排除内容，再按真实权限
编写和评审恢复 SQL；SQL 不包含凭据，不自动执行。隔离恢复后的独立采集和验证仍必须完成。

## 尚未完成的线上闭环

- 当前工作流覆盖 FTS-1 预检/迁移/回填/验证，不宣称全部生产运维功能已迁移完毕。
- ACL 双采集和授权公开附件入口已实现于工作区，尚未合并、实跑或完成永久入库。
  完整 catalog **不得直接放进公共 Actions 日志**。
  实际归档、人工复核及隔离恢复演练完成前，不执行新的 ACL normalization 或生产写入，
  不以本地执行替代。不得上传数据库备份到 Actions artifact。
- Topic 专用角色维护入口尚未纳入本工作流，共享实现和 CI 测试不删除。
- Vercel shadow 配置、重新部署、对账、database 切换与回滚仍在线上逐步执行，
  分别留存验收结果；数据库维护成功不会自动触发这些变更。

“环境已配置”“代码已验证”“工作流已合并”“线上任务成功”和
“FTS-1 已完成生产上线”是不同状态，必须分别记录。
