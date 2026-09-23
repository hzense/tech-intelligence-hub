# 候选补全生产启用记录（2026-09-23）

## 已核实

- PR #152 已合并，提交 `f530f7050b53297e3b3b304183986efedd720d1f`；PR CI `35873676877` 与 main CI `35874218436` 全部通过。
- Vercel Production `dpl_2toFG4XGxMTmp2D7sPxmXA7HCSe5` READY，`hzense.com` 已绑定此版本；健康检查 HTTP 200、`{"status":"ok"}`、`Cache-Control: no-store`。
- 已登录生产候选页，确认新增“启动 AI 自动补全”入口、原有候选和目录检查正常读取。未点击启动、未调用 AI。
- 隔离 PostgreSQL 验证 23 项迁移、52 张表；真实受限 generation 角色的补全 ACL/任务生命周期测试通过。
- 维护门禁 PR #153 已合并为 `77438ffc7ad262948e38bf3c45bec36895ed6004`，main CI `35875874787` 成功，本地 main 已同步。
- 只读 preflight `35875001784` 成功，`pendingMigrationCount: 1`。Neon 独立只读核验：22 项已应用迁移、补全任务表不存在、generation 角色现有 51 项列授权；当前会话为数据库 owner。
- 已核实从 main 当前数据和结构创建的七天备份存在，期限为 `2026-09-30T14:36:19Z`；备份标识仅存受保护 Secret。恢复能力未演练。
- 操作者确认本次维护暂停并行 DDL、ACL 和生产发布，并接受未演练恢复风险；此确认不授权付费 AI 调用或信号发布。
- ACL 只读采集 `35876624486` 成功，两次独立采集一致，下载附件重建校验通过。基线指纹：`e0bb31f9ecc248a2de172e2a193cb9a70b31869f65d163a3fae879c443545b20`；恢复状态仍为 `unverified-risk-accepted`。
- 迁移运行 `35877227649` 整体失败，公开分类为 `database-or-contract-check-failed`。随后 Neon 只读核验确认 23 项迁移和补全任务表已存在，generation 列授权仍为 51 项；因此不重跑 `migrate`，不将整体失败等同于迁移未落库。
- 新表约束定义与预期一致；只读角色权限诊断计数未见异常，雷达无证据快照和不合格证据计数均为 0。这些局部检查不是完整 Schema 通过证据，失败根因尚未确认。
- 独立只读核验 `35878223000` 仍失败。根因已定位并在隔离 PostgreSQL 复现：既有 `configure_candidate_pipeline.sql` 向 `hzense_candidate_verifier` 授予依赖锁函数 EXECUTE，但 `currentPublicationRoutines` 对该函数仅允许 `hzense_publisher`，导致合法授权被完整 Schema 核验误报。此问题在补全迁移前已存在，0022 不需要重跑。
- 本地修正仅为 `hzense_lock_publication_dependencies(text,integer)` 增加既有核验角色的精确允许项，不执行 GRANT、不改迁移或函数定义。新增单元测试覆盖合法授权、错误角色／grantor／权限／grant option 及其他函数越权；新增真实角色授权后的完整 Schema 集成测试。修正前两类测试均复现失败，修正后相关 118 项测试通过，隔离核验为 23 项迁移、52 张表、pgvector 0.8.6。尚未提交或部署，生产核验仍待修复上线后重跑。
- 数据库常规测试 2144 项通过、665 项条件集成测试跳过；其中候选管线角色集成测试已另行使用隔离 PostgreSQL 执行，5 项通过。数据库 lint、类型检查、改动文件格式与差异检查通过，临时测试服务已停止；未改生产权限或调用 AI。

## 维护边界

用户要求启用补全器，范围为新增 `0022_candidate_enrichment_runs.sql` 和 `upgrade_candidate_enrichment.sql` 精确列授权，不改密码、不调用付费模型、不发布信号。

旧 `accept-unverified-candidate-review` 策略仅允许 `0020–0021`，不得复用。新的 `accept-unverified-candidate-enrichment` 策略固定完整 23 项迁移文件及 checksum，实际待迁移只能是单个 `0022`；目标、备份标识、main 提交、run/attempt、有效期与冻结执行产物均重新核对。仅明确接受“恢复尚未演练”风险时使用该策略，不能把风险接受写成恢复能力已验证。

## 待完成

- [x] 只读生产预检（run `35875001784` 成功）。
- [x] 新备份存在性与有效期核对、维护窗口无并行 DDL/ACL/发布确认。
- [x] 绑定本次备份的 ACL 基线采集（`acl-capture` run `35876624486` 成功）。
- [x] 受保护 `0022` 迁移已落库（23 项迁移和新表经 Neon 只读核对）。
- [ ] 完整生产 Schema 核验（`verify` run `35878223000` 失败；本地核验器修正已通过隔离测试，待提交上线后仅重跑 `verify`）。
- [ ] owner 执行最小 ACL 升级、运行角色矩阵独立核验。
- [ ] 无 AI 的线上可用性检查；真实付费执行须单独确认。

生产读取日志有一条 `pg` 同 client 并行查询弃用警告，对应审核读取请求 HTTP 200；不是补全成功证据，也未阻断该次读取。
