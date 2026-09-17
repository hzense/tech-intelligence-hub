# 2026-09-17 AI 私有候选生成：生产数据库准备

## 状态与范围

本记录归档准备工作、分阶段授权及执行结果；`0015` 生产迁移、独立 Schema 核验、生成角色最小列授权及 owner 目录验收均已成功。具体状态以下方续接记录为准，不代表真实生成凭据／TLS／Production 服务连接已验收或 AI 生成已启用。

- 用户最初要求“准备生产数据库”；经本批独立批准，已执行唯一 `0015` 迁移。后续操作者手动创建生成角色并确认保存密码，授权前只读检查通过；再经执行时明确确认，已完成最小列授权及独立 owner 目录验收，尚未配置生成开关。后续风险确认与备份状态见下方续接记录。
- [PR #100](https://github.com/hzense/tech-intelligence-hub/pull/100) 已合并为 `fd528eabd95c04c942977b7a6cbe8bc894c5e0c2`；[main CI 35226592286](https://github.com/hzense/tech-intelligence-hub/actions/runs/35226592286) 成功，Production 部署代码已核验。候选生成仍默认关闭。
- 本批 `0015` 迁移、内置核验及独立 `verify` 均成功，生产结构为 16 迁移／48 表，只新增私有 `signal_generation_runs`。此前 `0014` 的 15 迁移／47 表是[导入阶段历史](2026-09-15-import-production.md)，不再是当前最新结构。
- 没有扩大 Import、AI、Runtime 或 Publisher 的权限；没有读取生产密钥到本地；没有真实模型请求或新增费用。

## 只读预检

[Production maintenance 35228294932](https://github.com/hzense/tech-intelligence-hub/actions/runs/35228294932) 由 `main@fd528ea` 发起，`operation=preflight`。用户完成 `production-maintenance` 人工审批后，于 **2026-09-17 13:44:48 UTC** 成功结束。执行步骤返回：

```json
{ "operation": "preflight", "status": "succeeded", "pendingMigrationCount": 1 }
```

该提交的迁移清单和连续历史检查表明唯一待执行项为 `0015_signal_generation.sql`；公开日志只输出数量，不输出目录／账本明细。此次没有迁移或权限写入，也未执行完整 Schema `verify`（新增表尚未创建）。

该版本尚不包含本次新增的生成计划门禁。因此本次成功只证明现有连接／迁移历史检查通过，不产生本批审核所需的生成计划指纹。准备代码合并、main CI 成功且本次备份引用核对后，须在同一最终 SHA 重新执行只读预检。

## 生产准备续接（2026-09-17）

- 准备工件已通过 [PR #101](https://github.com/hzense/tech-intelligence-hub/pull/101) 合并为 `07684bbcdc201c409dc87ee20b34f15885b07977`；[main CI 35230896157](https://github.com/hzense/tech-intelligence-hub/actions/runs/35230896157) 成功。对应 Production 部署成功只证明代码交付，不执行数据库维护。
- 操作者本次明确确认：维护期间无其他生产 DDL／ACL／发布并保持暂停；接受恢复能力未演练及历史 ACL 证据缺口，先建立保留 7 天的新备份，再执行本批 `0015`。风险仍包括数据损失或较长停机。这不是角色授权、AI 费用、开启生成或发布的批准，也不能替代每次 run 的 Environment 审批。
- 通过 Neon 受控页面从生产 `main` 的当前数据与结构建立新备份分支；页面核对创建时间为 **2026-09-17 14:27:31 UTC**，到期时间为 **2026-09-24 14:27:30 UTC**（页面使用 GMT+2）。未使用 schema-only、历史时间点或旧备份；未执行恢复、分支重置或恢复演练。
- 新备份引用已更新至 `production-maintenance` Environment 的 `MAINTENANCE_BACKUP_ID`，GitHub 元数据更新时间为 **2026-09-17 14:28:08 UTC**。公开记录只保留引用摘要 `3c5005c40fc0d441543f3d5991d130eaa3a11e37fe854bba314b8dcd96a486ac`，不记录原始引用或凭据。该摘要用于计划绑定，不证明恢复能力。
- 同一 SHA 的 [preflight 35233782900](https://github.com/hzense/tech-intelligence-hub/actions/runs/35233782900) 第 1 次尝试经操作者 Environment 审批，于 **2026-09-17 14:31:00 UTC** 完成并成功。返回 `pendingMigrationCount: 1` 和下列四项绑定摘要；备份摘要与本次新建引用一致。精确清单门禁只接受 `0015_signal_generation.sql`，不是普通 pending 数量推断，也未执行迁移、权限变更或模型调用。
- 查询时没有其他已知活动维护／发布任务；此检查不是持续排他锁。定时健康检查、原件清理与 Daily 候选任务使用独立 concurrency，不应被误记为全局串行；后续各阶段仍须复核维护窗口。

本次成功预检的公开摘要（执行步骤于 14:30:59 UTC 返回）：

```json
{
  "operation": "preflight",
  "status": "succeeded",
  "planFingerprint": "543f71f9caca5232a655d844eae8be5b7fee766b0c6fd8c615b5e87bc5458120",
  "manifestFingerprint": "9e217753ae9bf5ca19e0d28e1baacef6e2d6120d1aae1959ceaad77797aa9b6b",
  "targetFingerprint": "c0e6941bffa389ea26b20ed12a3c2f9237f28e03a7cc553ee5a39958e8fdc7ab",
  "backupIdSha256": "3c5005c40fc0d441543f3d5991d130eaa3a11e37fe854bba314b8dcd96a486ac",
  "pendingMigrationCount": 1
}
```

### ACL 双采集与附件审核通过

同一 SHA 的 [acl-capture 35234258207](https://github.com/hzense/tech-intelligence-hub/actions/runs/35234258207) 第 1 次尝试经人工批准，于 **2026-09-17 14:49:14 UTC** 成功完成，ACL 采集与附件上传步骤均成功。

- 本次 `MAINTENANCE_APPROVAL` 已保存至受保护 Environment，绑定该 run／attempt／operation、上述目标和备份摘要；元数据更新时间为 **2026-09-17 14:33:49 UTC**。审批有效期至 **2026-09-17 16:32:34 UTC**，早于备份到期。
- 恢复策略为 `accept-unverified-signal-generation`，三项恢复通过字段保持 `false`，省略 `restoreEvidenceFingerprint`；仅声明已核对备份存在性、冻结窗口及操作者本批风险接受，不伪造恢复验证。
- 依既有[当前仓库 ACL 公开归档授权](acl/README.md)，仅允许双采集一致后的受控 ACL 附件；禁止包含凭据、连接配置、原始备份引用及业务行。采集是两个独立只读连接，不修改角色或权限。
- 审批原始 UTF-8 JSON 的摘要为 `453c281489710c2700abc92cd1b9a10b33669606e2b38a22e709745e4899b18e`，已与运行实际公开的 `riskAcceptanceSha256` 及附件字段核对一致。

附件 [acl-evidence-35234258207-1](https://github.com/hzense/tech-intelligence-hub/actions/runs/35234258207/artifacts/10502688413) 为 24,880 bytes，上传 ZIP 摘要为 `4e91eb1e893b8afa65c79f9d657e72b30511aed8664debd50caa9db7be9efea4`，当前保留至 2026-10-17 14:49:11 UTC。已下载到临时目录进行只读审核，未将完整基线提交到代码仓；永久归档仍待完成。

- 附件 run／attempt／SHA、风险策略、审批摘要与线上运行一致；`recoveryVerified: false`、`restoration: unverified-risk-accepted`。
- 两次采集分别于 **14:49:07.629 UTC**、**14:49:09.381 UTC** 发生，均为只读 `repeatable read`；身份与目录内容逐项一致。
- 每次均为 **11 类、1,194 条**记录，声明计数与实际数组长度一致。对两份规范化内容分别重算 SHA-256，均为 `2180f9944cfa4e5945a28ef2b954f7b11f9e79f146aa4b942402c7d797ee23fe`，与日志和附件声明一致，作为本批迁移的 `aclFingerprint`。
- `providerApiVerified: false`、`executableSqlIncluded: false`；有限静态检查未发现匹配的凭据字段、Postgres URL 或私钥标记。公开材料仍包含已批准披露的 catalog 身份和对象名称，不称为完全匿名化，也未以静态扫描代替受保护 Secret 的排除检查。
- 用户反馈 warning 后，复核实际 check-run 的 annotations 为空、运行页为 Success；日志含 warning 的内容是 Git 初始化默认分支名称提示，不是 ACL／数据库告警。没有因此重跑采集。

上述结果只证明本批采集一致性与附件绑定，不证明备份可恢复或历史 ACL 缺口已消除。下一步使用新的独立迁移审批，不复用采集审批；角色授权、生成开关和模型费用仍在后续独立范围。

### 唯一 0015 迁移成功

[migrate 35236708426](https://github.com/hzense/tech-intelligence-hub/actions/runs/35236708426) 第 1 次尝试经人工批准，在同一 SHA 上于 **2026-09-17 14:58:44 UTC** 成功完成。执行步骤于 **14:58:39 UTC** 返回成功摘要；生产 `0015` 已执行，其内置完整 Schema 核验通过。

- 本次 run-bound `MAINTENANCE_APPROVAL` 已独立保存，元数据更新时间为 **2026-09-17 14:55:42 UTC**；有效至 **2026-09-17 16:54:25 UTC**，早于备份到期。原始 JSON 摘要为 `a07ae60103a231cb633a74bd9bf3267761336ca14cfca2a4d083d6e0c9327b63`，已与实际运行公开的 `riskAcceptanceSha256` 核对一致。
- 审批绑定本次 preflight 的目标／备份／清单／计划四项摘要及已审核的 ACL 指纹，保留 `recoveryVerified: false` 的风险路径，不复用采集 run／operation／批准。
- 独立只读复核确认 `0015_signal_generation.sql` 实际字节摘要与固定清单一致；仅创建私有 `signal_generation_runs`、相关约束和索引，撤销该新表 PUBLIC 权限并检查 owner-only ACL。不创建角色、授予生成访问权限、写入候选业务行、调用供应商或发布内容。
- 发起前再次核对 main、成功 CI、备份引用更新时间和已知活动任务；当前无其他已知活动任务。用户已确认的 DDL／ACL／发布冻结继续适用，不把此快照当作持续排他锁。

成功公开摘要：

```json
{
  "operation": "migrate",
  "status": "succeeded",
  "migrationCount": 16,
  "tableCount": 48,
  "planFingerprint": "543f71f9caca5232a655d844eae8be5b7fee766b0c6fd8c615b5e87bc5458120",
  "manifestFingerprint": "9e217753ae9bf5ca19e0d28e1baacef6e2d6120d1aae1959ceaad77797aa9b6b",
  "targetFingerprint": "c0e6941bffa389ea26b20ed12a3c2f9237f28e03a7cc553ee5a39958e8fdc7ab",
  "backupIdSha256": "3c5005c40fc0d441543f3d5991d130eaa3a11e37fe854bba314b8dcd96a486ac",
  "recoveryPolicy": "accept-unverified-signal-generation",
  "recoveryVerified": false,
  "riskAcceptanceSha256": "a07ae60103a231cb633a74bd9bf3267761336ca14cfca2a4d083d6e0c9327b63"
}
```

独立只读复核确认四项绑定摘要、计数和审批摘要逐项匹配。没有重复执行迁移，也没有创建生成角色、修改既有角色权限或调用模型。

### 独立 Schema 核验成功

同一 SHA 的 [verify 35237242986](https://github.com/hzense/tech-intelligence-hub/actions/runs/35237242986) 第 1 次尝试经人工批准，于 **2026-09-17 15:06:46 UTC** 成功完成。此 operation 仅进行只读预检和完整 Schema 合约核验，不读取写审批、不再次迁移或授予权限。执行步骤于 **15:06:43 UTC** 返回：

```json
{ "operation": "verify", "status": "succeeded", "migrationCount": 16, "tableCount": 48 }
```

独立核验确认 16 个迁移、48 张表；公开摘要不含 pending 数量，其内部检查要求无待迁移项。本批 Schema 升级闭环完成，不重放已成功的 `0015` 空计划。恢复能力未演练的风险，以及后续角色／预算／开关的独立授权边界不变；继续角色配置时仍须保持该操作范围的 DDL／ACL 冻结。

### 生成角色创建交接（执行前记录）

操作者要求执行下一步后，已通过 Chrome 在 Neon 核对生产 `main`，选择 `neondb` 并执行单条只读身份／角色存在性查询：

- `current_database = neondb`，`session_user = current_user = database_owner = neondb_owner`。
- `generation_role_exists = false`，创建者具备 `CREATEROLE` 且不是 superuser。此时专用生成角色尚未创建；角色列表与只读查询一致。
- 已将仓库 `db/roles/create_generation_admin.sql` 准备到新的编辑器查询，未点击 Run。脚本只创建全新受限登录凭据，无生成表授权；已有角色时拒绝，不轮换既有密码。新凭据的最终提交和安全保存交由操作者在 Neon 页面完成，不读取或归档密码。
- 已提出独立最小权限确认：角色 `LOGIN NOINHERIT`、连接上限 2，后续仅访问私有生成任务表的 22 个 SELECT／12 个 INSERT／9 个 UPDATE 列权限，以及目标库 CONNECT／public USAGE；不授予 DELETE、DDL 或其他业务表权限。本记录不将尚未回复的确认请求记为批准，也不将脚本已填入记为角色已创建。

后续只有在创建成功、操作者保存密码且授权范围明确确认后，才在 `main/hzense` 以 `hzense_migrator` 准备并执行独立固定列授权。授权后的 owner 目录核验与真实专用凭据／TLS 验收是不同检查；现有 Schema `verify` 不能替代它们。未创建本地维护工具，未配置 Production 连接、预算或生成开关。

### 操作者创建后只读核验通过（授权前记录）

操作者反馈“已创建并保存”后，通过独立 Chrome 页面在生产 `main/hzense` 执行两条只读目录查询。Neon History 显示查询时间为 **2026-09-17 17:21／17:23 GMT+2**；未打开创建凭据的结果、读取密码或重放创建 SQL。

- `current_database = hzense`，`session_user = current_user = database_owner = hzense_migrator`；`signal_generation_runs` 也归该 owner 所有，`0015` 固定 checksum 匹配。
- `hzense_generation_admin` 已存在；`LOGIN NOINHERIT`、连接上限 2，superuser／CREATEDB／CREATEROLE／REPLICATION／BYPASSRLS 均关闭。角色设置、所有权或直接 ACL 依赖、直接列 ACL 计数均为 0。
- 仅存在预期的 Neon 管理边：`neondb_owner` 为新角色的 ADMIN-only 管理成员，grantor 为 `cloud_admin`，INHERIT／SET 均为 false；新角色没有加入其他角色。
- 当前库 CREATE／TEMPORARY 为 false；不安全应用 schema 权限、PUBLIC 关系／列 ACL、PUBLIC／目标角色显式默认 ACL、可执行非扩展应用函数均为 0。
- 其他可连接数据库中，`neondb` 的 CONNECT／CREATE／TEMPORARY 及其 grant option 均为 false。`postgres` 与 `template1` 的 owner、模板标记、连接上限、PUBLIC ACL 和 grant option 符合既有脚本精确保留库例外；没有扩大这些例外或修改任何 ACL。

上述结果证明新角色已提交且具备授权前的受限形态，不证明新密码认证、TLS 或 Production 服务连接可用。现已提出执行时的最小授权确认：目标库 CONNECT、public USAGE，以及仅 `signal_generation_runs` 的 22 个 SELECT／12 个 INSERT／9 个 UPDATE 列权限。在操作者明确回复前不执行 GRANT；不把“已创建并保存”解释为列授权、预算或启用生成的批准。进展记录未包含密码或连接串。

### 最小列授权与独立 owner 目录验收成功

操作者对本次最小权限授权明确回复“确认”后，于 Neon 生产 `main/hzense` 执行仓库完整 `db/roles/configure_generation_admin.sql`，未摘取或单独执行 GRANT。脚本 SHA-256 为 `e8a9fa6b96be95a624119f77d891668b073ace0b190f7b0a8ca97ca704d070a1`；传入文本长度及校验值与仓库版本核对一致。

- Neon History 显示本次授权时间为 **2026-09-17 17:31 GMT+2**。8 条语句包括 BEGIN、2 条 SET、授权前 DO、2 条 GRANT、提交前 DO 和 COMMIT；最终 COMMIT 页显示 `Statement executed successfully`，不是停在 BEGIN 成功。
- Neon 提示只会截短超过上限的查询历史保存文本，不影响本次完整执行。不得从截短 History 重放授权；成功后脚本会拒绝已有直接 ACL，也没有重放本次授权。
- 在新的查询中执行与应用共用的完整 `generationRoleCheckSQL`（列清单按共享契约展开），返回唯一一行 `safe = true`。该检查只读 catalog，不读取私有生成任务行、不切换身份、不修复权限。
- 随后的独立只读摘要于 **2026-09-17 15:34:42.662424 UTC** 确认数据库及 owner 会话身份，并核对已提交的实际 ACL 数量：

```json
{
  "database": "hzense",
  "current_user": "hzense_migrator",
  "session_user": "hzense_migrator",
  "owner_identity_ok": true,
  "column_grants": { "INSERT": 12, "SELECT": 22, "UPDATE": 9 },
  "table_grants": 0,
  "database_grants": 1,
  "schema_grants": 1,
  "connection_limit": 2
}
```

已完成的访问范围仅为目标库 CONNECT、public USAGE 和生成私表 43 条固定列 ACL；没有 DELETE、DDL、表级通配权限、其他业务表访问或 grant option。保留此前受限角色属性及精确 Neon 管理边，不更改密码、其他角色、PUBLIC ACL 或业务数据，也没有新增模型请求或费用。

本次只完成 owner 目录验收，**不等价于**使用真实 `hzense_generation_admin` 密码的身份／TLS／Production 连接验收。当前 `readGenerationConfiguration` 要求显式开启生成且配置预算；后台生成列表还会处理过期任务，因此不能用它充当“生成关闭时”的纯只读连接预检。现有维护工作流亦未接入生成凭据。后续先补齐受控线上只读连接预检入口，再独立批准并配置 Production Secret、验收真实凭据与 TLS；不为测试连接提前启用生成，不沿用解析预算。AI 费用、开启生成、私有资料外发和真实模型验收仍未批准／执行。

## 已审核准备工件（PR #101）

| 工件                                               | 边界                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/production-maintenance.mjs`       | 新 `accept-unverified-signal-generation` 策略；固定 `0000–0015` 全清单及 SQL 摘要，pending 恰好为 `0015`；绑定实际目标、备份摘要、运行与计划；持锁时复核实际工件与同连接身份 |
| `db/roles/create_generation_admin.sql`             | Neon `main/neondb` 管理身份创建全新、空权限、非继承受限登录角色；已有角色时拒绝，不轮换密码                                                                                  |
| `db/roles/configure_generation_admin.sql`          | Neon `main/hzense` 数据库 owner 校验迁移及既有权限后，只授予生成表规定列的读／写权限；不清洗 PUBLIC 或其他角色 ACL                                                           |
| `packages/database/src/signal-generation-role.mjs` | owner 只读目录审计与专用身份权限核验；不授予权限、不生成密码                                                                                                                 |

role SQL 不是迁移的一部分，网页 Run／迁移成功均不会自动执行角色授权。角色不应拥有 DDL、DELETE、TRUNCATE、表级通配授权或业务表访问能力。

目录权限核验不是完整跨库对象扫描：只检查保留库的数据库级 ACL 形态，不连接其内部；扩展函数仍沿既有扩展成员豁免规则，不表示已逐个审计。SQL 无法辨认 Neon 分支，`main` 与实际目标必须在受控页面另外核对。此次未对这些既有边界作扩大授权。

## 生产执行顺序（各阶段独立核验）

1. 本批工件完成评审、测试、PR 合并，最终 main CI 成功。
2. 用户明确同意本批唯一 `0015` 迁移及后续独立角色授权。若选择恢复尚未演练的风险路径，必须重新确认本批风险；旧 `0014` 风险批准不能复用，不伪造恢复通过。
3. 在 Neon 建立并核对覆盖当前生产状态的新备份，核对父分支、时间点、保留期限；确认整个维护窗口无其他生产 DDL／ACL／发布。备份引用摘要只用于绑定，不能证明上述事实或可恢复性。
4. 受保护 `preflight` 获取同 SHA、当前目标与备份引用的计划；独立批准 `acl-capture`，审核本次双采集及公开归档范围。再为新的 `migrate` run 填写独立审批。
5. 只执行 `0015`，检查迁移返回及独立 `verify`，目标为 16 迁移、48 表、0 pending。若提交后核验失败，先查迁移账本，不盲目重跑空计划。
6. 经独立角色授权批准，在各 SQL 标明的数据库与身份下先创建、后配置；COMMIT 成功后才在受控页面交接新密码。保留现有密码和其他角色权限。
7. 以 owner 只读目录检查及专用角色自身连接验收最小权限，再单独配置 Production Secret、确认 AI 生成预算、重新部署和真实私有输入验收。

步骤 7 的预算、环境变量、开启生成、外发私有资料与供应商请求不属于本批数据库准备操作；不得自动沿用解析预算 10／50 美元。正式 Signal 入库、核验批准、公开发布或新站读取切换均不在范围内。

## 验证与剩余风险

本批本地验证结果：

- 全仓默认测试 **2810 项通过**；其中默认跳过的数据库／浏览器／解析场景不计入通过数。
- 单独启用的完整 PostgreSQL 18／pgvector 原生迁移回归 **626 项通过**，目标 Schema 为 16 迁移／48 表；新增角色回归 43 项已串入 `test:migrations`。生成角色及创建身份使用真实 TCP／SCRAM 密码认证，其余测试管理连接仅为隔离本地实例。
- 另在模拟 Neon `cloud_admin` bootstrap 的独立 PostgreSQL 实例运行同一角色回归，43 项通过：未经替换的创建 SQL 产生新密码，成功完成 SCRAM 认证；此实例仍是本地合成环境，不是 Neon。
- 独立维护门禁回归新增 119 项，固定列契约新增 7 项（已包含在默认测试总数）；覆盖历史审批拒绝、目标／备份／工件漂移、持锁复核和公开证据脱敏。
- 角色授权独立审查发现的 PUBLIC 重叠列授权漏报及额外 ACL 类别遗漏已修复；新增原生测试覆盖 owner／runtime 拒绝和提交前失败整事务回滚。普通跨库／默认 ACL、不可变列、表级授权和其他私表访问拒绝也已覆盖。
- lint、类型检查、构建、格式、工作流安全校验和维护脚本 ESLint 通过。

这些验证只使用本地合成数据与凭据，未调用模型；不视为 Neon 生产迁移／角色／凭据验收。本次准备工件通过 `chore/generation-production-preparation` 分支交付，评审、CI、合并及代码部署结果以该分支对应 PR 和运行记录为准。代码合并或部署不执行生产数据库操作。

恢复能力及历史 ACL 证据缺口仍未验证。本批没有启动新的恢复演练，也没有把“备份存在”“指纹一致”改写为“可恢复”。新策略必须显式保留 `recoveryVerified: false`；执行规程和不可执行审批模板见[全线上维护手册](../ONLINE_MAINTENANCE.md#ai-私有候选生成批次0015)。
