# ACL 恢复审查与隔离演练方案 — 2026-09-09

## 状态与已验证事实

**恢复 SQL 候选已开发并静态自审，`bd8f8c3` 的 PostgreSQL CI 已通过；独立审核与隔离演练未完成。**
实现见[受限恢复 SQL](../../../../db/roles/restore_fts_reader_acl.sql)及
[设计与限制](../../../../db/roles/README.fts-acl-recovery.md)。它不是本目录旧基线的通用恢复器。
本次测试与审核范围见[代码自审记录](./recovery-sql-review.md)。
修复后 [CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34363934742) 的三项任务均成功，
恢复 SQL 集成测试 14 项通过；作者账号的 `COMMENTED` 评价不等于正式批准或独立审核。
本文件不能作为 `restoreEvidenceFingerprint`，不能据此设置
`aclRecoveryReviewed`、`restoreRehearsed` 或历史缺口接受声明。

- PR #51 已合并为 `4370ad5749683f970ed4baa4ad6adcd8b37c4753`，
  [合并后 CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34339486640)
  已核验为 success。原始 `baseline.json` 保持不变。
- 本次通过 Neon 网页只读核验：项目显示 6 / 10 个分支，包含
  `pre-topic-0002-20260831-0049z`、`pre-fts1-recovery-20260908` 和
  `fts1-restore-rehearsal-20260908`。演练子分支的父分支是恢复基线，且显示自动过期标记。
- 项目 Dashboard 显示 History retention 为 6 hours。这不能覆盖十天前的变更时间点；
  历史独立分支/快照仍需另查，不能据此认定历史材料全部丢失。
- 本次尚未查到历史分支的内部 ACL、实际分叉时间或最后变更记录，
  也未重新确认演练分支的精确到期时间。分支名不是历史完整性的证明。
- 浏览器连接在列表核验后中断，重新连接仍未恢复控制。没有运行任何数据库 SQL，
  没有新建、重置、删除或延长分支，没有改动密码、权限或生产配置。

### 后续实际执行更新

操作者要求通过浏览器插件继续后，连接已恢复并在历史分支完成两批只读查询。
已取得角色状态及八类历史 ACL/迁移记录结果；演练分支到期时间确认是
2026-09-09 16:12（Europe/Berlin），仅查看后取消编辑。
详见[历史分支只读取证](./historical-probe.md)。上文连接中断是此前检查点，
不再是当前阻塞；历史缺口仍未关闭。操作者随后明确不延长演练分支，本次未调整期限。

## 对现有 SQL 与基线的审查

最新[只读身份核验](./neon-identity-checkpoint.md)确认：PR #53 已合并且 main CI 成功，
恢复源可读三项可信 Neon 身份参数；原隔离分支已不在列表中。此前的“仍列在项目中”
是历史检查点，不代表当前目标可用。本次没有创建替代分支或执行恢复写操作，
该段为 2026-09-09 检查点。2026-09-10 已开发受保护恢复态只读入口并提交
[PR #55](https://github.com/hzense/tech-intelligence-hub/pull/55)；入口仍待评审闭环、合并、配置与实跑，
真实 R1/R2、独立恢复审核、隔离演练及历史缺口仍未完成。

审查对象为当前主分支的 `db/migrations/0003_search_documents_fts.sql`、
`db/roles/configure_runtime_reader.sql`、`packages/database/src/runtime-reader-preflight.mjs`
及本目录原始基线。

| 对象                   | 审查结论                                                                                                                              | 对恢复方案的要求                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| FTS migration          | 在空派生表上新增 8 列、约束与索引；本身不授予 Runtime 搜索列权限                                                                      | 区分 schema/data 恢复与 ACL 恢复，不自动删除列、清表或伪造 migration ledger                |
| Runtime configurator   | 是前向 normalization，不是恢复器；除新增 Search 十二列 SELECT，还重整数据库、Schema、表/列、Sequence、enum、routine 及 owner 默认权限 | 不能只反转最后一条 GRANT 就声称恢复了整个配置事务；必须比较完整实际差异                    |
| 当前 ACL               | Runtime 只有 Topic 五列 SELECT、目标库 CONNECT、public USAGE、topic_status USAGE；没有表级 grant                                      | 保留 Topic 五列与 Topic sync、其他角色的已有权限                                           |
| Provider 对象          | 基线有 cloud_admin 管理的默认权限、pgvector routine 权限及角色关系                                                                    | 不生成全库 GRANT/REVOKE 重建，不修改 provider-owned 对象或 membership                      |
| 新版 Runtime preflight | 强制要求 FTS 18 列物理结构及十二列查询权限                                                                                            | 可用于 FTS 前向验收，不能原样用于恢复到 pre-FTS 权限后的成功验收；不得为取绿而放宽生产检查 |

### 受限增量恢复的候选范围

只有隔离演练证明 configurator 的实际差异**仅为**给 Runtime 新增以下十二列的
非 grantable SELECT，才可以把这些列的定向 REVOKE 作为增量恢复候选：

`source_id`、`source_type`、`title`、`summary`、`href`、`keywords`、`body`、
`document_date`、`normalized_title`、`normalized_summary`、`normalized_keywords`、
`normalized_body`（全部位于 `public.search_documents`）。

现已实现该受限范围的候选 SQL，但不能覆盖其它 ACL 漂移。执行者须是已认证的对象 owner，
核验 grantor、没有表级或间接授权、没有依赖授权；不使用 CASCADE。
撤销列级权限不能抵消表级权限，其他授权来源也可能继续提供有效访问。
见 [PostgreSQL 18 REVOKE](https://www.postgresql.org/docs/18/sql-revoke.html)。

正式脚本还必须具备：受保护的精确目标绑定、当前会话/数据库/owner 核验、
固定 `pg_catalog, pg_temp` search_path、超时、维护 advisory lock、
同事务前置漂移检查和后置验证；异常时完整回滚，不手工修改 PostgreSQL catalog。
仅匹配 `current_database() = 'hzense'` 无法区分 Neon 的 main 与同名隔离数据库。

如果 normalization 改变了其它授权、grantor、默认/显式 ACL 状态，必须暂停并针对
实际差异重新审查；不能忽略差异后把候选 SQL 提升为已审核恢复器。

## 历史证据缺口：继续查证，不代替操作者接受

1. 先在 `pre-topic-0002-20260831-0049z` 的详情页核验真实分叉点、保留期限、
   最近变更信息；只读查询迁移记录、Runtime 角色是否存在及相关 catalog。
2. Runtime 当时若尚未存在，记录“该历史状态未包含 Runtime”，不能把查询缺行
   当作空 ACL，也不能新建角色来让旧备份通过采集器的当前态身份合约。
3. 历史材料应另存来源与范围，不覆盖当前的 `baseline.json`，不冒充本次双采集。
   旧分叉点与实际 normalization 之间如仍有未记录的变更，历史缺口依然开放。
4. 若历史分支/快照无法补齐，向操作者说明明确缺失的时间段和对象范围，
   再请求接受以当前态为新恢复起点。此前的公开归档许可和继续工作指令均不等于接受。

## 隔离演练顺序与验收

1. **重新绑定目标和窗口**：确认隔离分支并非 main 或唯一恢复基线；复核父分支、
   保留时间与 DDL 冻结。原采集审批已于 `2026-09-09T10:00:00Z` 到期，
   不能复用到新的 SHA、run 或写操作。重置与权限扩展在执行前取得明确授权。
2. **建立 R0**：在隔离目标进行完整独立只读采集，确认其与已复核恢复源相符，
   单独保存 schema/data 校验、所有 ACL 类别及 Runtime 实际登录检查。
3. **建立 R1**：仅在隔离副本执行并验证 FTS migration，重新采集。
   R0 → R1 的物理结构差异单独登记，不能拿原顶层指纹直接验收新增列后的目录。
4. **建立 R2**：经审批在同一隔离目标应用前向 Runtime 配置，重新采集，
   对 R1 → R2 做完整 ACL 差异审查。候选增量恢复必须覆盖实际变化，不能只看权限总数。
5. **审核并验证恢复**：用真实 R1/R2 验证候选恢复 SQL 的适用性并独立复核；
   先验证错误目标、错误角色、额外 grant/owner 漂移会拒绝执行，再在正确隔离目标恢复。
   不人为给 Runtime 扩展超出 FTS allowlist 的权限来制造测试条件。
6. **建立 R3**：新的独立只读采集须与 R1 的完整 ACL/同 schema 状态一致；
   保留 schema/data 校验，确认 Topic sync 与 provider 授权未变化。SQL 成功提示不算验收。
7. **独立 Runtime 验证**：使用 Runtime 自身认证连接而非 owner 的 SET ROLE。
   Topic 五列实际读取成功，metadata、Search、其他应用表写入/读取及 grant option
   按恢复态合约拒绝，provider 例外保持原边界。`default_transaction_read_only=on`
   只是默认事务设置，不替代 ACL 验证。需准备受保护的线上恢复态验证入口；
   当前固定 FTS 合约的生产预检不能替代它。
8. **可选完整 provider 恢复**：若还需证明 schema/data 整体恢复，另行审批后仅重置
   隔离子分支，再独立比对 R0。它不代替步骤 5–7 的 ACL 恢复 SQL 验证。
9. **归档与人工结论**：保存实际执行 SQL/hash、目标的脱敏绑定、时间、独立采集、
   正反向检查及 reviewer 结论。所有结果真实完成后，才可建立新的生产写审批。

## 当前待办

- [x] 核验 PR #51 永久入库和合并后 CI。
- [x] 审查 migration、前向 ACL 脚本、当前权限及预检的恢复兼容性。
- [x] 历史检查点：当时在线确认历史候选分支和隔离子分支仍列在项目中；2026-09-09 后续检查时原隔离分支已不在列表中，此项不代表当前目标可用。
- [x] 恢复浏览器连接并完成初步历史目录取证、复核演练分支期限；完整历史覆盖仍未证明。
- [x] 遵照操作者决定，不延长演练分支；到期后不得复用旧目标授权。
- [x] 开发十二列受限恢复候选、同事务前后指纹核验及静态测试，并完成代码自审。
- [x] `bd8f8c3` 的 CI PostgreSQL 集成测试实跑通过：恢复 SQL 14 项；完整 CI 成功。
- [ ] 真实 Neon R1/R2 适用性验证与独立审核；CI fixture 不替代真实恢复证据。
- [x] 开发[受保护线上只读验证入口](../../../RECOVERY_VERIFICATION.md)，支持独立双采集与 Runtime 恢复态检查；未声明合并或实跑。
- [ ] 完成历史缺口处理及线上恢复态入口的评审、合并、配置与实跑。
- [ ] 获得准确目标的执行授权，执行隔离演练并归档真实结果。
- [ ] 解除生产写操作门禁；本次未进行迁移、回填或搜索切换。
