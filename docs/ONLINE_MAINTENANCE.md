# 全线上生产维护

自 2026-09-07 起，操作者批准采用 GitHub Actions + Neon Console + Vercel
的全线上运维边界。无需安装本地运维 CLI、创建 `.env.fts1.local` 或在终端输入生产密码。
共享迁移、同步、权限检查代码及其 CI 测试继续保留，作为线上 runner 的实现。

## 当前落地状态

- 历史 110 条 Seed Signal 迁移新增独立 dry-run／apply／verify 操作，仅支持已验证恢复路径；
  0028、档案导入及三列公开读取授权在一个事务中提交，随后独立核验。执行说明见
  [历史信号迁移](LEGACY_SIGNAL_MIGRATION.md)。代码能力不代表生产已执行，须以本批运行证据为准。

- 2026-10-04，生成信号附带资源资料的能力升级新增独立 `editorial-resource-grant`
  维护操作，**本批尚未执行生产授权**。资料仍存于既有不可变发布修订 JSON，实体及人物／组织
  类型档案使用已有表；没有新增结构迁移。新增权限及其批准流程见下方说明。

- 2026-10-02，**配置删除已启用**。应用 [PR #186](https://github.com/hzense/tech-intelligence-hub/pull/186)
  与独立维护入口 [PR #187](https://github.com/hzense/tech-intelligence-hub/pull/187) 已评审合并，
  main `d460a3c` 的 CI 通过。新审批的
  [运行 37026577164](https://github.com/hzense/tech-intelligence-hub/actions/runs/37026577164)
  完成 `0027`、独立 28 项迁移／60 表核验及固定增量授权，最终待迁移为 0、角色列能力为 84 项。
  自动采集及专题洞察页通过实际存储读回，一条未启用采集专用配置完成保存—刷新—软删除—再次刷新验收；
  原有两条配置保留，无新增运行记录，正式域名部署及数据库健康已核对，本次维护窗口结束。
  不改凭据、不调用 AI，执行开关仍关闭。
  新备份保留至 `2026-10-09T14:08:59Z`，恢复仍未演练。见
  [本批证据](production-evidence/2026-10-02-automation-config-deletion.md)。
  下方标注“0026 本地修改”等内容保留历史边界；旧 0026 清单与批准不扩大、不复用。

- 2026-10-02 新增 `migrate-and-verify` 单次审批流程，本批为本地修改，未提交／未上线。
  仅面向 `0026` 自动任务配置存储批次，在一个受保护 job 内顺序完成预检、ACL 双采集、
  迁移和独立结构核验；原有独立入口及其审批隔离保留。详见下方
  [0026 单次审批维护](#0026-单次审批维护)。这不表示生产配置已可保存。

- 2026-09-10 操作者决定本轮不再验证恢复能力，并同意新增显式风险接受审批路径。
  写操作路径已随 PR #56 合并为 `9220df0`，对应 main CI 与受保护只读 preflight 成功。
  本次补齐前置 ACL 只读采集路径，须经 PR 审核、合并及 main CI 成功才可使用，
  详见[检查点](./production-evidence/2026-09-10-fts1-preflight.md)。
  恢复能力和历史 ACL 缺口仍为未验证，不因风险接受而变为已通过。本记录不是生产执行证据。

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
  `acl-capture` 已通过 [PR #49](https://github.com/hzense/tech-intelligence-hub/pull/49)
  合并为 `main@8ed8e87` 且 main CI 成功；2026-09-09 已完成首次线上双采集，
  真实基线永久归档与 ACL 恢复审核/演练仍待完成，
  详见[当日门禁记录](./production-evidence/2026-09-08-fts1-gates.md)。
  最新结果见 [2026-09-09 采集记录](./production-evidence/2026-09-09-fts1-acl-capture.md)。

## 网页配置

进入仓库 [Environments 设置](https://github.com/hzense/tech-intelligence-hub/settings/environments)，
选择 `production-maintenance`，在 **Environment secrets** 添加现有值。
不要用 Repository secrets、普通 Variables、workflow inputs、Issue、聊天或提交文件传递凭据。

| Secret                        | 用途                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_DIRECT_URL`         | `hzense_migrator` 的生产 direct 连接，带显式端口，使用 `sslmode=verify-full`                                                 |
| `HZENSE_RUNTIME_DATABASE_URL` | 现有 `hzense_runtime` pooler 连接，带显式端口，只使用 `sslmode=verify-full&channel_binding=prefer` 两个查询参数              |
| `MAINTENANCE_BACKUP_ID`       | 本次审核的真实备份 ID；严格路径验证恢复，风险路径核验存在性/目标/期限；写操作、`acl-capture` 及只读 `preflight` 计划绑定使用 |
| `MAINTENANCE_APPROVAL`        | 针对一次写操作或 ACL 公开采集的受保护 JSON 审核记录，格式见下文                                                              |

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
   写操作必须完成严格恢复审核，或明确选择下述相应批次的风险接受路径；
   两种路径均须在审批前更新 `MAINTENANCE_APPROVAL`，不可复用旧 run 的审批。
3. 审批后由 GitHub hosted runner 执行。若等待期间 `main` 前进或最新 push CI
   不是 success，初检失败，不进入持密执行步骤；需针对新的 `main` 重新发起、审核。
   新增的执行入口复核会在数据库模块加载前再次检查 main、最新 push CI，再回读 main，
   并重验写操作审批有效期。复核失败不会调用数据库代码。
4. 查看最终 JSON 和任务结论。公开输出仅保留计数、指纹和有界错误分类，
   不输出完整 catalog、文档 ID、URL、角色详情、备份 ID、原始错误或堆栈。
   失败时在 Neon 受控页面继续诊断，不开启原始数据库调试日志。

| operation            | 执行内容                                                                         | 写数据库                     |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `preflight`          | direct 目标、TLS、版本和迁移历史检查                                             | 否                           |
| `migrate`            | preflight → 校验清单中的迁移 → schema verify                                     | 是，需恢复审核               |
| `verify`             | preflight + 完整 schema 合约检查                                                 | 否                           |
| `search-dry-run`     | 检查迁移/schema 后计算回填计划，回滚事务                                         | 不提交变更                   |
| `search-apply`       | 加锁后重核投影/计划指纹，回填并验证无残留漂移                                    | 是，需恢复及计划审核         |
| `runtime-preflight`  | Runtime 自身凭据的 TLS、跨库与最小权限检查                                       | 否                           |
| `acl-capture`        | 两个独立只读连接采集 ACL，一致后生成已授权的公开证据附件                         | 否，需备份/冻结/公开授权     |
| `migrate-and-verify` | 冻结批次：预检 → ACL 双采集与归档 → migrate → 独立 verify；0027 另含固定增量 ACL | 是，需一次匹配批次的完整审批 |

所有维护使用固定 concurrency group，不会自动取消正在执行的维护。
GitHub concurrency 不是持久 FIFO 队列，不要同时提交多次请求。
不要在迁移中手动 Cancel；多条迁移可能已部分提交，中断后先只读核验再决定重跑。
没有任意 SQL、任意 shell、任意 ref、自动 ACL normalization 或自动切换搜索的入口。

## 0026 单次审批维护

本节描述 2026-10-02 新增的本地实现，须经 PR、合并及对应 main CI 成功后才可在线使用。
`operation=migrate-and-verify` 将本次配置存储维护合并为一个
`production-maintenance` 受保护 job，只需针对这次运行点击一次 **Review deployments**。
该批准覆盖下面的完整顺序，不是关闭环境审批或自动批准后续运行：

1. **runner prepare：只读 preflight 与 ACL 双采集**：校验生产目标、TLS、迁移历史，
   以及已批准的完整清单和待迁移计划；再用两个独立连接采集权限基线，一致才安全保存
   脱敏证据。禁止预填或借用另一个 run 的 ACL 指纹。此时 `status=prepared`，不是整个
   维护流程已完成。
2. **upload-artifact：先完成远端归档**：只有真实证据安全落盘后才上传固定附件。
   上传必须成功才能进入 apply；上传失败不执行 DDL。
3. **runner apply：migrate**：读取绑定同一 run／SHA／attempt 和原始审批摘要的证据，
   沿用原有迁移校验，在迁移锁内重新核对待迁移计划及刚采集的 ACL 基线，不一致立即
   停止。只有本次批准的 `0026_automation_tasks.sql` 可以进入迁移计划。
4. **runner apply：独立 verify**：迁移成功后再进行独立的只读完整 Schema 核验，
   不以迁移步骤返回成功代替完整核验。最终 apply 完成才报告 `status=succeeded`。
   任一步失败即停止，不执行剩余阶段。

prepare、附件上传与 apply 都在同一个已批准的受保护 job 内，阶段由工作流固定，
不由操作者填写，也不需要额外 preflight 或阶段审批。

此入口仅支持 `recoveryPolicy: "accept-unverified-automation-storage"` 与
`riskAcceptance.scope: "automation-storage-production-launch"`，冻结完整 `0000–0026`
迁移清单；不是通用批量迁移开关，不能借用 FTS-1、AI 配置或其他旧批次的风险授权。
新备份、真实保留期限、目标和计划复核、维护期间 DDL／授权／发布冻结、main 与最新 CI
检查、审批有效期，以及恢复尚未演练的明确风险声明都保留。

### 审批绑定与准备

创建新 run 后、批准 Environment 前，更新受保护的 `MAINTENANCE_APPROVAL`。
它必须绑定此次 `operation`、完整 `sha`、`runId`、`runAttempt`、`expiresAt`，以及
备份 ID 摘要、备份期限、`targetFingerprint`、`manifestFingerprint` 和 `planFingerprint`。
这些指纹可以在批准前纯计算生成：使用当前 main 固定的 `0026` 迁移计划与完整清单、
经操作者独立确认的预期生产目标及新备份，通过 `automationTargetBinding` 和
`automationMigrationPlan` 计算，不连接生产数据库。已有同目标、同备份、同迁移清单的
脱敏预检结果可辅助复核，**不必为取得同一计划再单独发起一次 preflight 审批**。
预期目标不能从待检连接串自动推导，备份存在性与期限仍须人工核对；占位值不能通过门禁。
获准组合 run 的第一阶段才读取实时连接与 pending 状态，必须与明确批准的计划完全一致
才能进入后续采集和迁移，纯计算计划不作为实时数据库状态证明。

与独立 `migrate` 入口不同，新入口**不填写 `aclFingerprint`**，而是明确选择
`aclEvidenceMode: "capture-in-run"`，同意在这个已批准运行内生成真实 ACL 双采集证据。
`publicArchiveApproved: true` 和 `archiveRepository: "hzense/tech-intelligence-hub"`
均为必填声明；脱敏附件只包含已授权的权限目录材料，不输出密码、连接串、Token、
连接主机／端口、原始备份 ID 或业务记录。

只有真实双采集证据安全落盘成功后，prepare 才设置固定的附件就绪 output flag；
上传步骤只读取固定证据文件，远端归档成功是 apply 执行的前提。未成功落盘时不发布
就绪标记，也不以其他文件或伪造附件补位。进入迁移前已经完成远端归档，即使后续
migrate 或独立 verify 失败，真实脱敏附件仍保留用于核查。

审批模板如下；占位符与 `false` 用来提示需要逐项复核，**模板本身不可执行**：

```json
{
  "operation": "migrate-and-verify",
  "sha": "本次main完整SHA",
  "runId": "本次运行编号",
  "runAttempt": "本次尝试编号",
  "expiresAt": "未来最多24小时的UTC时间",
  "backupExpiresAt": "晚于审批到期的真实备份过期时间",
  "backupIdSha256": "受保护MAINTENANCE_BACKUP_ID原始文本的SHA256",
  "targetFingerprint": "本次目标与备份绑定指纹",
  "manifestFingerprint": "当前完整迁移清单指纹",
  "planFingerprint": "本次0026待迁移计划指纹",
  "backupVerified": false,
  "backupPresenceReviewed": false,
  "restoreRehearsed": false,
  "aclRecoveryReviewed": false,
  "ddlFreezeConfirmed": false,
  "recoveryPolicy": "accept-unverified-automation-storage",
  "riskAcceptance": {
    "scope": "automation-storage-production-launch",
    "accepted": false,
    "historicalAclGapAccepted": false,
    "acknowledgement": "recovery-unverified-data-loss-or-prolonged-outage-accepted"
  },
  "aclEvidenceMode": "capture-in-run",
  "publicArchiveApproved": false,
  "archiveRepository": "hzense/tech-intelligence-hub"
}
```

审核真实备份、冻结状态、风险接受和公开归档范围后，才将相应确认项设为 `true`。
`backupVerified`、`restoreRehearsed`、`aclRecoveryReviewed` 仍保持 `false`；不能添加
伪造恢复证据。备份不过期时沿用下方二选一规则，不同时填写期限与不过期声明。
旧 `preflight`、`acl-capture`、`migrate`、`verify` 入口仍可独立使用，但它们的旧批准
不能用于新组合操作；改变 SHA、运行、尝试编号或审批过期后，都需要新的完整批准。

### 失败处置与范围

本流程不会自动重试、自动回滚或自动执行恢复 SQL。**迁移阶段开始后的失败，可能已提交
部分或全部迁移**，包括随后独立 verify 失败的情况；先只读核对迁移记录和实际结构，不能
把失败结论理解为“数据库未变更”，也不能直接重跑。需要重新执行时，准备新的计划与
run-bound 审批，再经新的 Environment 人工批准。

一次审批只覆盖这次数据库维护，不包含角色创建／授权、密码设置、Vercel 连接配置或
重新部署，也不启用采集、定时计划、AI 调用及专题公开读取。迁移核验成功后仍须单独处理
最小角色与连接，并验收“保存未启用配置、刷新读回、不创建任务”，才可称为配置存储启用。

## 0027 配置删除单次审批维护

本节是固定范围的执行规程，不可代替实际运行证据。2026-10-02 的 `0027` 迁移、独立核验、
固定最小授权和有界页面删除验收已完成，见[本批证据](production-evidence/2026-10-02-automation-config-deletion.md)。
以下规则仍适用于该批次的授权边界；其他环境或后续运行必须独立核对状态并取得新的批准，
不能复用本次 Environment 审批、备份绑定或维护冻结声明。恢复未演练的事实不变。

### 固定范围

- operation 仍为 `migrate-and-verify`，但必须使用独立策略
  `accept-unverified-automation-config-deletion` 和风险范围
  `automation-config-deletion-production-launch`。
- 冻结完整 `0000–0027` 共 28 项迁移文件与摘要，仅允许待迁移集合恰好为
  `0027_automation_config_deletion.sql`。旧 `accept-unverified-automation-storage`
  仍冻结 `0000–0026`，不能借用其批准执行 `0027`。
- 除新增 `automation_configs.deleted_at` 及一致性约束，只允许固定脚本
  `db/roles/upgrade_automation_config_deletion.sql` 授予现有专用角色对该列的
  `SELECT` 和 `UPDATE`：精确列能力由 82 项增至 84 项，不创建角色，不改密码，
  不增加 `INSERT`、表级权限、转授权或其他表能力。
- 授权脚本 SHA-256 固定为
  `3372dcc11b59e8747589cf34f016a030c08f454a961b1d8a96a315e08d01bde2`。
  不接受调用者传入 SQL／文件路径，不新增通用 grant operation。

### 审批与顺序

先完成本批 PR 评审、合并及对应 main CI；保留新的生产备份并独立核对目标及真实保留期限。
维护期间暂停其他生产 DDL、角色授权及发布。创建新 run 后，在 Environment 批准前更新
受保护的 `MAINTENANCE_APPROVAL`：沿用上节的 SHA、run／attempt、期限、备份／目标／清单／
计划指纹、冻结和公开归档绑定，但改用本节独立 policy／scope。另必须显式填写：

```json
{
  "roleUpgradeApproved": true,
  "roleUpgradeSha256": "3372dcc11b59e8747589cf34f016a030c08f454a961b1d8a96a315e08d01bde2"
}
```

上述只是完整审批中的增量字段，不能单独执行。`backupVerified`、`restoreRehearsed`、
`aclRecoveryReviewed` 仍为 `false`，不能把风险接受写成恢复已验证。备份不过期声明与真实
到期时间仍须二选一；期望目标不得由待检连接串反推。新备份、目标和冻结清单可用于纯计算
批准计划，实际 pending 集合仍须在获准运行中只读核对，不能把计算结果当作生产事实。

一次 **Review deployments** 只批准同一受保护 job 的完整固定顺序：

1. **prepare**：只读 preflight 校验当前目标、迁移历史、28 项冻结清单及唯一待迁移项；
   两个独立只读连接采集 ACL，一致后安全落盘并绑定同一 run／SHA／attempt／审批摘要。
   这一步仅为 `prepared`，不代表升级完成。
2. **远端归档**：固定脱敏 ACL 附件上传成功后才能进入 apply；失败不执行 DDL。
3. **apply / migrate**：迁移锁内重新核对实际计划及 ACL 基线，仅执行获准的 `0027`。
4. **apply / 独立 verify**：通过独立只读完整 Schema 检查，预期为 28 项迁移／60 张表；
   不以迁移返回成功代替完整核验。
5. **apply / 固定增量授权**：先核对本节授权脚本摘要与显式批准，再以认证数据库 owner
   执行该固定事务；脚本核对 `0027`、角色属性及精确授权集，不相符则停止。只有这一步
   也通过才能报告本次组合流程成功。

所有阶段使用当次批准，不要求重复点击阶段审批，但也不自动批准后续运行。授权事务的
直接列 ACL 检查不代替应用角色的完整环境权限守卫；组合流程成功也不等于用户已能删除。

### 失败与最终验收

迁移与授权不是同一事务。**迁移提交后若独立核验或授权失败，`0027` 可能已经落库，
配置存储会因权限尚未齐全而暂时不可用。** 此时保持冻结，先只读核对迁移／Schema／ACL；
不自动重放迁移、恢复 SQL、清理配置或放宽权限，也不直接将故障归因于密码。
需要续接时根据实际状态制定新计划并取得相应新审批，不能复用已失败运行的旧批准。

成功后保持冻结至实际专用角色的完整权限检查及两个配置页读回通过。随后仅创建一条专用
未启用测试配置，执行一次保存、刷新读回、确认软删除和再次整页刷新；确认测试配置隐藏、
现有配置仍保留、运行历史与费用未变，且没有新增运行任务。提交结果未知时先查状态，
不自动重试。具备以上证据才标记“删除功能已启用”；没有证据的检查保持待完成。

本批不需要新凭据或修改 Vercel Secret，不开启采集／定时任务／公开洞察读取，不调用 AI，
不删除已有配置。公开记录只保留必要计数、摘要、脱敏结果和证据链接，不保存完整连接串、
原始目标标识、备份 ID、密码或 Token。

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

隔离恢复的只读采集与恢复态 Runtime 检查有单独的
[线上验证入口](./RECOVERY_VERIFICATION.md)。它不复用生产连接，不执行迁移、授权或恢复 SQL，
也不替代下述生产写操作门禁；入口上线状态以对应 PR/CI 与实际 run 为准。

原有 [FTS-1 上线顺序](./DEPLOYMENT.md#fts-1-数据库搜索上线顺序) 与
[ACL 恢复门禁](./DEPLOYMENT.md#runtime-acl-恢复基线) 保留为默认严格路径。
本轮 `migrate` / `search-apply` 及其前置只读 `acl-capture` 可以显式选择下一节的风险接受路径；
这不授权执行恢复 SQL、重置分支或 destructive ACL normalization。
默认严格路径先在 Neon 完成备份独立恢复验证、冻结 DDL、双重 ACL baseline 采集复核、
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

### 备份保留方式（二选一）

以下规则同时适用于 `migrate`、`search-apply` 与 `acl-capture`：

- 有过期时间：保留上例 `backupExpiresAt`，填写真实日期字符串且严格晚于
  `expiresAt`；`backupNeverExpires` 可省略或为布尔值 `false`，兼容已有审批格式。
- Provider 明确显示不自动过期：**删除整个 `backupExpiresAt` 字段**，改为
  `"backupNeverExpires": true`。不得同时填写两个字段，也不能用 `null`、空字符串、
  `"never"` 或虚构日期代替。`"true"` 字符串不是布尔值 `true`。

不自动过期是针对 `MAINTENANCE_BACKUP_ID` 对应真实备份的人工复核声明，
不是系统自动查询 Neon 的结果，也不保证备份不会被手动删除。审批人仍须确认
备份覆盖目标、在整个维护窗口内保留且不会被删除；严格路径还须验证可恢复性，风险路径
明确保留恢复能力未验证的状态。记录 provider 保留设置
的复核证据和后续清理安排。不能仅凭该字段认定 `backupVerified` 或恢复演练通过。

此选项**不会延长审批有效期**：`expiresAt` 仍必须在未来且不超过 24 小时，
执行入口仍重查 main、最新 CI、运行绑定及有效期；备份 ID 摘要、冻结、公开授权、
写操作恢复审核及回填计划指纹等原有门禁保持不变。

不自动过期支持已通过 PR #50 合并为 `main@b4619e6`，合并后 CI 成功；
2026-09-09 已用于只读 ACL 采集，不表示写操作恢复门禁已经通过。

这些字段是审核声明和防误用门禁，**不是**程序自动验证 Neon 备份、恢复证据或人工审核真实性。
`backupIdSha256` 是未加域前缀的 ID 摘要，与 ACL 工具的域分隔 `backupReference` 不同，
不可混用；审批人必须核对受保护原件。摘要应在线上受控证据处理环节生成，不使用公开哈希网站。

### FTS-1 显式接受恢复未验证风险

这是操作者于 2026-09-10 选择的替代审批路径，不是恢复验证成功记录。
默认省略 `recoveryPolicy` 或使用 `"verified"` 时，原严格恢复门禁不变；未知值、
`null`、严格路径混入 `riskAcceptance`、风险路径伪造恢复通过字段均拒绝。

仅在针对本次 run 的受保护 `MAINTENANCE_APPROVAL` 中选择
`"recoveryPolicy": "accept-unverified-fts1"`，并逐项确认以下声明：

```json
{
  "operation": "migrate",
  "sha": "本次main完整SHA",
  "runId": "本次运行编号",
  "runAttempt": "本次尝试编号",
  "expiresAt": "未来最多24小时的UTC时间",
  "backupExpiresAt": "晚于审批到期的真实备份过期时间",
  "backupIdSha256": "受保护MAINTENANCE_BACKUP_ID原始文本的SHA256",
  "backupVerified": false,
  "backupPresenceReviewed": false,
  "restoreRehearsed": false,
  "aclRecoveryReviewed": false,
  "ddlFreezeConfirmed": false,
  "aclFingerprint": "本次冻结窗口双采集并审核一致的ACL摘要",
  "recoveryPolicy": "accept-unverified-fts1",
  "riskAcceptance": {
    "scope": "fts1-production-launch",
    "accepted": false,
    "historicalAclGapAccepted": false,
    "acknowledgement": "recovery-unverified-data-loss-or-prolonged-outage-accepted"
  }
}
```

模板不可执行。审批人核验 provider 上备份存在、对应准确生产目标、覆盖维护时间窗后，
才将 `backupPresenceReviewed` 设为 `true`；它不表示恢复能力已测试。
`backupVerified`、`restoreRehearsed`、`aclRecoveryReviewed` 必须明确保持 `false`，
整个 `restoreEvidenceFingerprint` 字段必须删除，不能填伪造证据、空串或 `null`。
冻结发布和 DDL 后设置 `ddlFreezeConfirmed: true`，明确接受故障时可能数据丢失或
长时间不可用、历史 ACL 缺口仍未补齐的风险后，才将两项风险确认设为 `true`。
这些都是人工声明，不是程序对 provider 或审批者身份的独立证明。

真实备份 ID、保留期限（二选一规则不变）、main/CI、SHA/run/attempt/operation、审批时限
和 Environment 人工审批仍然必需。写操作仍要求当前完整 ACL 双采集指纹；前置的
`acl-capture` 不要求尚未产生的 `aclFingerprint`，但必须单独批准公开归档，格式见下节。
`search-apply` 还必须提供
同 SHA dry-run 的 `projectionFingerprint` / `planFingerprint`，实际 Apply 仍重算并拒绝漂移。
风险路径的迁移预检只接受 pending 为 `0003_search_documents_fts.sql` 或空列表（no-op）；
其它迁移一律停止；持有迁移锁后，执行迁移 SQL 前再核验实际 pending 清单。
仍须保持冻结窗口，GitHub 检查与数据库操作并非原子事务。

成功摘要固定标记 `recoveryPolicy: "accept-unverified-fts1"`、`recoveryVerified: false`，
并记录原始审批 UTF-8 字节的 `riskAcceptanceSha256`；不输出原始审批、备份 ID 或凭据。
此摘要不是签名或独立审核证明，须关联相应 GitHub run / Environment 人工审批记录。
失败不会输出成功摘要。只读 ACL 采集采用同样的风险声明，仍使用绑定 `acl-capture`
的独立采集审批；不能复用迁移审批，也不能用采集审批执行迁移或回填。

本次只调整两项 hosted 写操作及前置只读 ACL 采集的审批方式；不增加任意 SQL、自动授权、自动切换或
关闭预检的开关。Runtime 前向最小授权须另行评审，不能据此重新执行 destructive
normalization；生产 Runtime preflight、shadow 对账、切换和功能验收也不豁免。

### AI 配置批次的显式风险接受

2026-09-14 操作者另行同意：在新的当前生产备份保护下，接受恢复尚未演练的风险，
按序升级 `0004–0013`，仅启用 AI 配置后台，不开启 Signal 自动发布或切换网站读取。
新策略 `accept-unverified-ai-config` 不能借用 FTS-1 的 scope；默认 `verified` 和旧 FTS
策略的规则保持不变。代码合并与 CI 通过后才可使用，实际执行状态见
[本批记录](./production-evidence/2026-09-14-ai-configuration.md)。

新策略仅允许 `migrate` 及其独立 `acl-capture`，不允许 `search-apply`。使用上节的
run-bound 审批字段，替换以下两项：

```json
{
  "recoveryPolicy": "accept-unverified-ai-config",
  "riskAcceptance": {
    "scope": "ai-configuration-production-launch",
    "accepted": false,
    "historicalAclGapAccepted": false,
    "acknowledgement": "recovery-unverified-data-loss-or-prolonged-outage-accepted"
  }
}
```

这只是不可执行的字段模板，不是完整审批，也不是风险已接受的默认值。确认真实备份、
冻结窗口及风险后才填写声明；`backupVerified`、`restoreRehearsed`、
`aclRecoveryReviewed` 始终为 false，不提供 `restoreEvidenceFingerprint`。
`acl-capture` 仍需 `publicArchiveApproved: true` 与准确 `archiveRepository`，使用独立
run／operation 审批；后续迁移填写本次双采集并审核的 `aclFingerprint`。

`migrate` 还必须提供同 SHA 在线 `preflight` 输出的 `manifestFingerprint` 和
`planFingerprint`。实现独立固定了 `0000–0013` 的名称及 checksum，完整工件有变动
或新增迁移时不出具这批指纹；pending 只允许 `0004–0013` 的非空连续后缀，不能跳过
中间迁移、夹入其他迁移或扩大到未来版本。第一次为全部十项，部分提交后的恢复执行
必须重新预检、确认账本、审核新计划与新 run，不复用旧指纹。全部已应用时改运行
独立 `verify`，不以空计划重放 AI 写审批。

两种指纹使用带版本的域前缀与有序名称／checksum 清单计算。迁移锁前及持锁后的实际
pending 清单均重新核对；整个迁移工件、运行、提交、备份、期限及 ACL 审查分别绑定。
成功摘要保留 `recoveryPolicy: "accept-unverified-ai-config"`、`recoveryVerified: false`
和审批摘要，不输出审批正文或秘密。逐文件事务不是整批原子事务；批准尚未失效的
旧计划不能覆盖部分完成后的新状态。

这条路径不创建密码或角色，也不执行 ACL 授权。Schema 核验完成后，使用 Neon SQL
管理身份通过独立 `db/roles/create_ai_admin.sql` 候选创建全新的空受限角色，再用数据库 owner 执行固定的
`db/roles/configure_ai_admin.sql`。不要使用 Neon Roles 普通创建流程临时赋予
`neon_superuser` 成员关系；[Neon 的角色兼容性说明](https://neon.com/docs/reference/compatibility)
区分了控制台／API 创建角色与 SQL 创建角色的默认权限。凭据录入和服务端变量保存
遵守浏览器确认／交接要求；不将密码放入提交、聊天、日志或本地生产文件。

非超级用户 SQL 创建者仍会收到 bootstrap superuser 保留的 ADMIN-only 管理边，
不能用创建者自己的 REVOKE 撤销。AI 初始化仅接受 `cloud_admin` 将
`hzense_ai_admin` 授给 `neondb_owner`，且 `ADMIN=true`、`INHERIT=false`、
`SET=false` 的精确入向边；不接受任何 AI 角色的出向成员关系。管理员仍可重新授予
该角色，这是云管理员控制边界，不是 AI 角色获得管理员权限。创建候选由操作者提交，
只在 COMMIT 成功后使用返回密码；已有角色时拒绝，不重置密码或尝试反复创建。

### AI 私有候选生成批次（0015）

2026-09-17 准备新增独立策略 `accept-unverified-signal-generation`。**本节是待审的执行规程，不是生产迁移完成或风险接受记录。** 只覆盖 `0015_signal_generation.sql`：增加私有候选任务账本，不生成正式 Signal、不自动发布、不授权模型费用。实际状态见[准备记录](production-evidence/2026-09-17-generation-preparation.md)。

固定整个 `0000–0015` 清单及每项 SQL 字节摘要，pending 必须恰好为 `0015_signal_generation.sql`。旧的 FTS、AI 配置或导入风险审批均不能执行本批；清单变化、未来迁移、已全部应用的空计划都拒绝。迁移前预检与持锁执行前均检查实际执行工件；持锁时重新读取同一连接的身份。

使用上文完整 run-bound 审批格式，另填以下字段。下例只是不可执行的片段；确认真实备份、冻结窗口和本批风险后才能填写真实值：

```json
{
  "recoveryPolicy": "accept-unverified-signal-generation",
  "targetFingerprint": "同一SHA线上preflight生成的目标摘要",
  "manifestFingerprint": "同一SHA线上preflight生成的清单摘要",
  "planFingerprint": "同一SHA线上preflight生成的计划摘要",
  "riskAcceptance": {
    "scope": "signal-generation-production-launch",
    "accepted": false,
    "historicalAclGapAccepted": false,
    "acknowledgement": "recovery-unverified-data-loss-or-prolonged-outage-accepted"
  }
}
```

此策略只允许 `migrate` 和独立的 `acl-capture`，不允许 `search-apply`。两者均绑定目标、备份摘要、SHA/run/attempt/operation、有效期及人工 Environment 审批。`migrate` 需要上述全部指纹和本次审核的双采集 `aclFingerprint`；`acl-capture` 需要 `targetFingerprint` 及公开归档批准，不要求尚未产生的 ACL 指纹和迁移计划字段。两次运行须各自批准，不复用 run 或 operation。

`preflight` 仅在精确迁移范围且已有格式有效的 `MAINTENANCE_BACKUP_ID` 时给出本批指纹；缺失或超出范围只返回普通预检结果，不开放迁移。指纹把实际目标及备份引用绑定到计划，**不证明 Neon 备份存在、父分支正确、快照足够新或可恢复**。必须在受控网页核对新备份覆盖当前生产状态、目标和保留窗口；不能把导入之前的旧备份当作当前备份。

风险路径保留 `backupVerified: false`、`restoreRehearsed: false`、`aclRecoveryReviewed: false`，不填 `restoreEvidenceFingerprint`；只有明确确认存在性、冻结和风险后才设相应声明为 true。严格 `verified` 路径保持不变。公开摘要和 ACL 附件均保留该批次策略、`recoveryVerified: false` 和审批摘要，不输出凭据、目标明文或备份 ID。

执行顺序为：本批代码合并与 main CI → 核对新备份与维护冻结 → 同 SHA `preflight` → 独立 `acl-capture`／审核 → 独立 `migrate` → 独立 `verify`。若迁移执行后的核验失败，先检查迁移账本及表，不盲目重放；应用完毕的目标不再接受本批空迁移。

迁移审批不创建角色、不授予 ACL、不保存密码。完成 Schema 核验后，角色创建和固定列授权仍须单独同意：先在 Neon `main/neondb` 以 `neondb_owner` 执行 `db/roles/create_generation_admin.sql`，再在 `main/hzense` 以 `hzense_migrator` 执行 `db/roles/configure_generation_admin.sql`。以脚本自身身份、数据库、迁移与权限检查为准；发现意外权限时停止，不自动修复。密码仅在 Neon 受控结果中产生和交接，禁止复制到仓库、聊天、日志或本地文件。生产环境变量、AI 预算、开关与真实供应商验收均在后续独立进行。

## 当前仓库 ACL 公开归档

2026-09-08 操作者在获知当前仓库公开、角色关系/对象名称/详细权限和恢复脚本可能
被长期保留后，明确回答“允许”。本次归档位置为 `hzense/tech-intelligence-hub`，
不再要求新建私有仓库。范围见[归档约定](./production-evidence/acl/README.md)。
此决定只改变材料可见性，不表示备份验证、历史缺口接受或恢复演练已完成。

入口变更须先经过 PR 审核、合并及 main CI。之后按所选路径核验本次 provider 备份，
冻结发布与 DDL/ACL，发起 `acl-capture`，在人工审批前更新 `MAINTENANCE_APPROVAL`。
以下为默认严格采集格式，只有真实验证后才能将 `backupVerified` 设为 `true`：

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

上述严格格式中的占位符和 `false` 不能通过。若本轮按操作者决定不验证恢复能力，
使用以下显式风险采集格式；不能把 `backupVerified` 改成 `true` 来绕过检查：

```json
{
  "operation": "acl-capture",
  "sha": "本次main完整SHA",
  "runId": "本次运行编号",
  "runAttempt": "本次尝试编号",
  "expiresAt": "未来最多24小时的UTC时间",
  "backupExpiresAt": "晚于审批到期的真实备份过期时间",
  "backupIdSha256": "受保护MAINTENANCE_BACKUP_ID原始文本的SHA256",
  "backupVerified": false,
  "backupPresenceReviewed": false,
  "restoreRehearsed": false,
  "aclRecoveryReviewed": false,
  "ddlFreezeConfirmed": false,
  "publicArchiveApproved": false,
  "archiveRepository": "hzense/tech-intelligence-hub",
  "recoveryPolicy": "accept-unverified-fts1",
  "riskAcceptance": {
    "scope": "fts1-production-launch",
    "accepted": false,
    "historicalAclGapAccepted": false,
    "acknowledgement": "recovery-unverified-data-loss-or-prolonged-outage-accepted"
  }
}
```

模板仍不可执行。核验真实备份的存在性、生产目标与维护窗口/保留期限，确认发布与 DDL/ACL
冻结、公开归档范围及两项风险接受后，才将对应确认字段设为 `true`。三项恢复通过字段
必须保持 `false`，不填写 `restoreEvidenceFingerprint`。不自动过期备份仍按上文二选一规则
删除 `backupExpiresAt` 并声明 `backupNeverExpires: true`。采集不要求 `aclFingerprint`，
避免先有基线才能采集基线的循环依赖；后续写操作仍须单独审核实际双采集基线与相应计划。
任何采集审批都不授权 `migrate` / `search-apply`，其它门禁保持不变。
两次独立采集各自只读并关闭连接，重建校验指纹且比较一致；开始、两次采集之间及写出
证据文件前重验审批。发现不一致或失败时不归档部分结果。

公开日志仍仅包含摘要。唯一允许的附件文件为 hosted runner 临时目录中的
`hzense-acl-evidence.json`，附件名 `acl-evidence-<runId>-<runAttempt>`，保留 30 天。
该文件不是数据库备份：包含两份 catalog 基线、运行标识及固定审批状态，不包含业务行、
原始审批或原始备份 ID。风险路径的附件顶层固定记录 `restoration: "unverified-risk-accepted"`、
`recoveryPolicy: "accept-unverified-fts1"`、`recoveryVerified: false` 和与日志一致的
`riskAcceptanceSha256`。内层基线格式、内容及指纹算法不变；旧路径保留原有顶层格式。
双采集一致只证明当时 catalog 一致，不证明备份可恢复或历史缺口已补齐。
归档步骤不注入生产凭据；不上传目录、配置文件或任意路径，不自动向 main 写入文件。
附件应视为公开材料。审核并在过期前通过 GitHub 网页将其归档到
`docs/production-evidence/acl/<runId>-<runAttempt>/baseline.json`，经 PR 复核后合并；
未完成此步不得称为“代码仓永久归档已完成”。无需本地密码配置或本地采集工具。

附件审查应核对来源 run/attempt/SHA、两份基线及分类指纹、排除内容，再按真实权限
编写和评审恢复 SQL；SQL 不包含凭据，不自动执行。默认严格恢复路径仍须独立采集和演练验证；
本轮显式风险路径不新增演练，但必须保留恢复能力未验证的事实。

## 尚未完成的线上闭环

- 当前工作流覆盖 FTS-1 预检/迁移/回填/验证，不宣称全部生产运维功能已迁移完毕。
- ACL 双采集和授权公开附件入口已随 PR #49 合并；2026-09-09 首次实跑成功，
  两份基线独立重建校验通过，永久入库仍待归档 PR 审核合并。
  完整 catalog **不得直接放进公共 Actions 日志**。
  新的 ACL normalization 仍需原恢复门禁；本轮 FTS-1 迁移/回填可以使用上述显式
  风险接受路径，不以本地执行替代。不得上传数据库备份到 Actions artifact。
- Topic 专用角色维护入口尚未纳入本工作流，共享实现和 CI 测试不删除。
- Vercel shadow 配置、重新部署、对账、database 切换与回滚仍在线上逐步执行，
  分别留存验收结果；数据库维护成功不会自动触发这些变更。

“环境已配置”“代码已验证”“工作流已合并”“线上任务成功”和
“FTS-1 已完成生产上线”是不同状态，必须分别记录。

## 任务管理批次（0016–0018）

2026-09-19 操作者明确选择接受恢复能力及历史 ACL 缺口未验证可能导致的数据丢失或延长停机风险，范围仅限本批迁移及必要列权限。执行状态须以实际运行记录为准。

独立策略为 `accept-unverified-task-management`，`riskAcceptance.scope` 为 `task-management-production-launch`。采用上文完整 run-bound 审批结构，保留三项恢复字段为 false；不得填造恢复证据。新策略固定 0000–0018 全清单及 SQL 字节，只接受 0016–0018 非空有序后缀，旧策略范围不变。

顺序：核对备份父分支与保留期限、冻结 DDL/发布 → preflight 取得目标/备份/工件/计划摘要 → 新 run 审批并双采集 ACL → migrate → 独立 verify → 数据库 owner 执行 `db/roles/upgrade_task_management_visibility.sql` → 服务角色自身只读核验 → 应用发布另行验收。逐文件事务若部分完成，必须新预检、重新绑定剩余后缀，禁止复用原计划。

列权限升级为独立事务，共用迁移锁：先校验 owner、0016–0018 ledger/列结构及两个旧角色的完整权限矩阵，只新增各自 `deleted_at` 的 SELECT/UPDATE，再验证两个新矩阵后提交。已有权限漂移、PUBLIC 暴露、grant option、已升级状态均拒绝，不重建角色、不改密码、不自动修复 ACL。通用初始角色配置脚本要求空角色，不用于升级现有角色。

## 生成资源发布的独立权限升级

`editorial-resource-grant` 仅执行固定的
[`upgrade_editorial_resources.sql`](../db/roles/upgrade_editorial_resources.sql)。
新增 `hzense_editorial_writer` 对 `entities(id,name,type,status,aliases)` 与
`person_profiles/organization_profiles(entity_id,entity_type)` 的列级 SELECT、INSERT。
不授予实体 metadata、UPDATE、DELETE 或表级权限；公开读取仍通过既有已发布修订视图，
草稿不会创建正式实体。此操作不会发布内容、调用 AI 或修改旧档案。

按以下顺序发布，避免旧部署与新增权限不兼容：

1. 先部署兼容旧／新两套精确 writer ACL 的应用，核验旧任务读取和旧发布操作仍可用。
   部分权限、额外权限和授予选项仍被拒绝；新资源发布在尚无授权时失败关闭。
2. 当前 main CI 成功后，运行受保护 `Production maintenance` 的 `preflight`。
   待迁移必须为 0，完整结构保持 28 项迁移／60 表。提供真实且在维护窗口内有效的备份引用时，
   预检返回本批 `manifestFingerprint`、`planFingerprint`、`targetFingerprint`、
   `backupIdSha256`、`roleUpgradeSha256`，其中计划固定全部已应用迁移及本批授权 SQL 字节。
3. 为即将执行的 `editorial-resource-grant` 运行配置新的 `MAINTENANCE_APPROVAL`。
   `operation`、`sha`、`runId`、`runAttempt`、有效期、备份及目标指纹必须匹配本次执行；
   同时要求 `roleUpgradeApproved:true` 和预检返回的全部五项指纹。
   本入口只接受现有 `verified` 恢复政策，必须有 `backupVerified:true`、
   `restoreRehearsed:true`、`aclRecoveryReviewed:true`、`ddlFreezeConfirmed:true`、
   真实 `aclFingerprint`、`restoreEvidenceFingerprint` 及覆盖窗口的备份保留声明。
   旧 0025/0027 的风险接受与旧运行批准不会自动授权本批；未满足这些条件时停在预检，
   不能把未演练恢复声明成已通过。
4. 经保护环境批准后执行 `editorial-resource-grant`。工具持有迁移会话锁，重新核对目标、
   完整迁移和结构、已批准 PUBLIC ACL 指纹、当前 main/CI 与审批有效期，才执行固定授权。
   SQL 在同一事务内检查旧或升级后精确有效／直接列权限，完成后独立核验结构。
   成功报告 `roleUpgradeCompleted:true`。提交结果未知或提交后核验失败时报告失败及
   `roleUpgradeMayHaveCommitted:true`，不自动重试；先只读核对角色权限，再决定新的批准动作。
5. 保留维护窗口，核验线上 writer 精确角色检查及一条明确授权的生成／审核／发布流程。
   新资源应在确认发布后同时出现在目录、详情和信号关联中；每份资料只引用其实际证据来源。
   完成这些检查后才宣告功能已启用。

`configure_editorial_roles.sql` 用于全新空角色初始化，现有生产角色只使用上述固定升级入口。
回滚代码时应保留兼容两套 ACL 的版本；不能把新增权限的角色切回只接受旧权限的旧部署。
