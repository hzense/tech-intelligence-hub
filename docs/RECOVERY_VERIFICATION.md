# 隔离恢复的线上只读验证

状态：入口代码与测试已开发并提交 [PR #55](https://github.com/hzense/tech-intelligence-hub/pull/55)，
**尚未合并或线上实跑**。这不是恢复演练完成记录。
操作入口为 `.github/workflows/recovery-verification.yml`，不增加本地维护 CLI 或 `.env`，
不改变 `production-maintenance.yml` 和既有生产写审批规则。

## 能做什么

| operation         | 行为                                                         | 不证明的事项                              |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `capture-r0`      | 在 10 列 Search 的隔离副本上双采集                           | 与恢复源的 schema/data 完整一致性         |
| `capture-r1`      | 在 18 列 Search 的副本上双采集，记录迁移后状态               | migration ledger / 完整 DDL 验收          |
| `capture-r2`      | 同一目标前向授权后的双采集                                   | 实际差异仅为十二列授权，仍需人工审核      |
| `capture-r3`      | 双采集并要求新格式目录指纹等于已审 R1                        | 数据恢复、独立 Runtime 登录与完整演练通过 |
| `verify-restored` | Runtime 自身认证、R1 指纹、恢复态权限矩阵及实际读取/拒绝检查 | 自动审批、历史缺口已接受或生产上线        |

每份采集在同一个 repeatable-read / read-only 事务中输出现有十一类完整 ACL 材料，
加上恢复 SQL 使用的新格式目录摘要；随后关闭连接，用第二个独立连接重复采集并比较。
两种格式不能混用。R0 → R1 存在 schema 变更，不要求指纹相等；R1/R2/R3 必须来自同一分支
同一 timeline、同一 schema。R1/R2 的原始 catalog 差异必须另行审查，不能只比较摘要或计数。

恢复态 Runtime 检查复用完整权限检查器与严格 provider 例外，唯一合约区别为 Search
可读列必须为空（物理结构仍须有 FTS 18 列），Topic 五列保持可读，所有其它表/列权限、
grant option、sequence、routine、owner、membership 和跨数据库检查不放宽。
同一受检分支上的 Neon 保留数据库仍逐库连接验证，不把 provider 例外删除来获取绿灯。
目录采集使用 `pg_catalog, pg_temp`；Runtime 合约检查使用 `pg_catalog, public, pg_temp`，
保持 catalog 优先，同时保留已有 provider 类型/函数签名指纹所依赖的 public 类型可见性。

实际权限探测使用 `SELECT ... LIMIT 0`：Topic 五列成功、Topic metadata 和 Search title
必须返回 `42501`，使用 savepoint 恢复错误状态。不会执行测试 DML；写权限由完整有效权限
矩阵检查，`25006` 只读事务错误不算 ACL 拒绝。没有读取、保存业务行。

结果中的 `runtimeAuthenticated` / `negativeReadsDenied` 是完整 preflight 成功返回后的
断言结论，不是独立采集的原始 SQL 行；`verificationBasis` 明确标记为
`completed-runtime-preflight-assertions`。计数来自 preflight 返回值。身份、有效权限、
实际读取/拒绝、保留库验证或清理中任一步失败，都不输出成功结论。

采集与 Runtime 检查共享清理规则：连接成功后尝试 ROLLBACK，随后始终尝试关闭。
连接/检查已有错误时保留该原始错误；无原始错误但回滚或关闭失败时仍判为失败，
不发布成功附件。连接未成功不发 ROLLBACK，以免覆盖真实连接失败。

生产 `runRuntimeReaderPreflight` 和 CLI 不接受恢复模式参数；即使传入 `restoredAcl`，
原生产合约仍要求十二列 Search 权限。恢复检查只有独立函数和受限 hosted 入口。

## 凭据与审批

沿用已有受保护 `production-maintenance` Environment，不重置或轮换密码。
在入口合并、main CI 成功、准确隔离目标经授权创建并核验后，才配置以下 **新名称**：

- `RECOVERY_OWNER_URL`：隔离分支 Migrator 的直连，明确 `:5432/hzense`，`sslmode=verify-full`。
- `RECOVERY_RUNTIME_URL`：同一隔离分支 Runtime pooler 连接，明确端口，
  仅 `sslmode=verify-full&channel_binding=prefer` 两个参数。
- `RECOVERY_APPROVAL`：下述 run-bound JSON。只保存到 Environment secret，不提交实际值。

不要填生产或唯一恢复源连接。两种数据库凭据按 operation 分别注入，不在一个执行步骤
同时提供；不接受 `DATABASE_DIRECT_URL`、`HZENSE_RUNTIME_DATABASE_URL` 等生产回退。
依赖安装步骤不接收数据库凭据，执行前及每次新连接前复核当前 main/最新成功 CI/有效期。
只输出固定状态和有界失败分类，附件只上传固定文件且仅在任务成功后执行。

审批模板（占位符与 false 不可执行）：

```json
{
  "operation": "capture-r0",
  "sha": "运行的完整提交SHA",
  "runId": "本次run编号",
  "runAttempt": "本次attempt编号",
  "expiresAt": "未来最多一小时的UTC时间",
  "projectId": "经页面独立核验的项目ID",
  "targetBranchId": "新的隔离分支ID",
  "sourceBranchId": "恢复源分支ID",
  "productionBranchId": "生产分支ID",
  "targetFingerprint": "隔离分支三个可信Neon参数的SHA256",
  "sourceFingerprint": "独立核验恢复源得到的SHA256",
  "productionFingerprint": "独立核验生产得到的SHA256",
  "directHost": "经独立核验的隔离直连主机",
  "runtimeHost": "同一endpoint的pooler主机",
  "targetExpiresAt": "晚于本次审批到期的时间",
  "sourceNeverExpires": true,
  "topologyReviewed": false,
  "ddlFreezeConfirmed": false,
  "publicArchiveApproved": false,
  "archiveRepository": "hzense/tech-intelligence-hub"
}
```

若恢复源有期限，使用 `sourceNeverExpires: false` 加 `sourceExpiresAt`，并确保覆盖审批窗口；
所有时间字段仅接受 `YYYY-MM-DDTHH:mm:ssZ` 或 `YYYY-MM-DDTHH:mm:ss.sssZ`，
校验真实日历日期；拒绝本地时间、时区偏移、宽松文本格式或自动归一化的无效日期。
不允许同时声明永不过期和日期。`capture-r3` / `verify-restored` 还必须提供
`r1Fingerprint`，来源为同一目标真实 R1 的 `state.fingerprint`，不是原 `baseline.json` 指纹。

三个分支 ID 和三个目标摘要分别两两不同。会话须提供非空、注册为 postmaster 的三项
Neon 参数；项目/分支须匹配审批，项目/分支/timeline 的组合摘要也须一致。
拒绝生产/恢复源摘要、错误数据库/角色、SET ROLE、非 PG18、非只读事务及 enabled event trigger。

**拓扑与保留期限是操作者通过 Neon 页面独立核验的声明，不是本入口的 provider API 验证。**
必须核实隔离分支不是 default/main、父分支是审批中的恢复源，并有准确执行窗口。
不能从待检 URL 推导期望主机，不能按分支名字猜 ID，不能自己填写三个随机摘要来通过检查。
服务端摘要提供实际身份绑定，但不能独立证明父子拓扑或备份可靠性。
如后续需要自动拓扑核验，Neon 提供只读[分支详情](https://api-docs.neon.tech/reference/getprojectbranch)
与[endpoint 列表](https://api-docs.neon.tech/reference/listprojectbranchendpoints)接口；本次未引入 API key 或调用这些接口。

## 上线顺序与审核点

1. 入口代码走 PR 审核并合并，等待精确 main CI 成功。配置/回读 Environment 的 main-only
   分支限制与 required reviewer，禁止绕过；作者 COMMENTED 不等于独立审核。
2. 获得准确新隔离目标授权后创建副本；不延长旧分支，不在生产或恢复源上演练。
   单独核验拓扑、身份、恢复源有效性与窗口；在网页配置既有角色凭据，不把密码传到聊天或本地文件。
3. Actions 选择 **Isolated recovery verification → main → capture-r0**。
   在 Environment 审批前将 SHA/run/attempt/operation 写入审批，核验后由授权人审批。
4. R0 双采集之外，另做恢复源与副本的 schema/data/Topic/迁移记录校验。
   经准确目标的写审批执行迁移，采 R1；经权限变更审批执行前向配置，采 R2。
   本入口没有这些写操作，不能拿生产操作入口绕过审批。
5. 独立审核完整 R1/R2 差异和恢复 SQL；如果差异超出十二列 SELECT，停止并重新设计。
   完成历史缺口处理后，再取得隔离恢复执行授权；不自动赋予批准布尔值。
6. 执行获批恢复 SQL 后，分别 `capture-r3`、`verify-restored`，每次使用新 run-bound 审批。
   独立检查 schema/data、Topic sync 和 provider 权限保留证据，再归档结论。

每份成功 run 的附件为 `recovery-verification-<runId>-<attempt>`，仅含
`hzense-recovery-verification.json`，保存 30 天；审核后按现有公开许可永久归档当前仓库。
原始 `baseline.json` 不覆盖。附件含完整 catalog，不能归档密码、Token、原始分支/备份 ID、
主机、连接串或业务行。失败运行不发布附件，不开启数据库原始错误日志。

附件的 `approval` 保存固定白名单的脱敏审批摘要：operation/SHA/run/attempt、时限、
保留期声明、三类目标摘要、适用时的 R1 指纹、冻结/拓扑/公开许可声明，
以及原始 `RECOVERY_APPROVAL` UTF-8 文本的 `recordSha256`。不复制未知字段，
不保存原始项目/分支 ID、主机或审批 JSON 本体。
`recordSha256` 绑定提交给本次运行的原始字节（包括空白），用于持有原始受保护记录时比对；
它不是数字签名，也不能从摘要恢复原文或证明审批者身份。信任根仍是 Environment 审批者，
复核时还须关联对应 GitHub run 的审批记录；不能用摘要取代人工审批。

## 明确保留的风险与未完成事项

- 同 runner 的依赖供应链风险仍存在，步骤级 secret 隔离不等于进程安全隔离。
- 恢复验证与生产写工作流共享 `production-maintenance` Environment，技术上同属该环境的
  工作流可引用其中任一 secret。目前互斥注入和禁止生产回退是代码/流程约束，不是
  平台级凭据隔离；文档不能保证恶意工作流或依赖无法接触这些凭据。本轮不更改线上
  Environment；拆独立环境、迁移 secret 和重新配置保护规则须另行授权、实施并验收。
- GitHub 复核与数据库不是原子操作，仍需冻结发布和 DDL/ACL；采集一致不代表全局冻结成立。
- 本入口只读，不运行恢复 SQL，不重置分支，不提供任意 SQL/shell/ref；线上写操作仍需单独授权。
- 历史分支只证明 pre-Topic-0002 状态，没有证明旧分叉点到后续 Runtime normalization
  之间的完整权限变化。新的 R0–R3 只能证明本轮恢复能力，不能自动补齐过去的缺口。
  若无法获得覆盖缺失区间的备份/变更材料，应向操作者说明后请求接受“当前态为新恢复起点”；
  本次执行指令和公开归档授权不代替该风险决定。
- 新增 PostgreSQL 集成测试在一次性 CI cluster 执行；本地无隔离数据库时跳过，
  不安装本地数据库，也不把 mock / core fixture 当作 Neon 成功路径证据。
