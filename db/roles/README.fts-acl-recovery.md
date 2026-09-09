# FTS 列权限恢复候选 SQL

状态：**开发候选；已做代码静态自审，未完成独立审核、PostgreSQL CI 实跑或 Neon 隔离演练。**
不允许根据本文件设置 `aclRecoveryReviewed` / `restoreRehearsed`，不接入生产自动执行。
没有新建本地维护 CLI，也不需要 `.env`。实际执行仍只能走获批的线上维护流程。

## 范围与不支持的情况

- [restore_fts_reader_acl.sql](./restore_fts_reader_acl.sql) 只有一个权限修改语句：
  从 `hzense_runtime` 撤销 `public.search_documents` 的十二列 SELECT，显式 `RESTRICT`。
- 保留 Topic 五列权限、其他角色、provider 权限及默认 ACL。不删除 FTS schema、索引或业务行，
  不修改迁移记录，不恢复早期较宽的 PUBLIC 权限，不是通用备份恢复器。
- 仅当 R1 → R2 完整审查证明前向配置只增加这些列权限时适用。若 normalization
  同时改变其它 ACL，必须另行开发并审核；后置指纹不同会使整个恢复事务失败。
- 要求 PostgreSQL 18、固定数据库 `hzense`、直接认证的数据库与表 owner
  `hzense_migrator`、正常 Runtime 角色、FTS 18 列结构与迁移记录。
- 拒绝表级有效 Search 权限、间接 Runtime 成员关系、grant option、额外列访问、
  投影表继承/RLS、enabled event trigger、错误目标、过期声明与目录漂移。
  唯一允许的 provider 成员关系与前向配置一致：`neondb_owner` 对 Runtime 的
  admin-only 关系，由 `cloud_admin` 授予，不允许 inherit/set。

## 同一 schema 的实际证据

在**同一个隔离分支、同一个 timeline**，用独立只读连接采集：

1. R1：FTS migration 后、前向 Runtime ACL 配置前。
2. R2：前向 Runtime ACL 配置后。人工审核原始 catalog 差异，确认只增加十二列权限。
3. 经批准执行恢复后另采 R3，必须与 R1 比对，并用 Runtime 自身认证连接验证读取/拒绝矩阵。

[fts_acl_recovery_state.sql](./fts_acl_recovery_state.sql) 用只读事务输出目录指纹、
分类计数/指纹与 Neon 目标摘要，不输出原始配置值或业务行。它只用于本候选的漂移核对，
不能取代现有完整 ACL 双采集或实际 schema/data 校验。R1/R2 审核必须同时保存现有采集器
产生的完整目录材料；只有摘要无法审查实际差异。

指纹格式 `hzense-fts-acl-state/v1` 与归档 `baseline.json` 的格式不同，不能混用。
范围为当前库的非系统 schema、relation、column、type、routine ACL/身份元数据，
加全局角色、成员关系、角色数据库设置、数据库 ACL、默认权限、policy 与继承关系。
NULL/显式 ACL 不合并；排序固定为 C collation；时区固定 UTC。包含 OID 与服务端版本，
不能跨分支、重置、升级或 schema 变更直接复用。系统 schema 权限、函数实现、完整 DDL、
业务数据、密码及云端拓扑不在这个摘要的验收范围。

## 受保护声明

以下是同一执行连接的 session setting，不是代码内常量，不应提交实际值。
线上执行入口尚未接入；不要在控制台填猜测值后直接运行候选 SQL。

| Session setting（统一前缀 `hzense.acl_recovery.`） | 来源                                                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| `before_fingerprint`                               | 已审核 R2 的新格式目录指纹                               |
| `after_fingerprint`                                | 同一目标、同一 schema 的真实 R1 新格式目录指纹           |
| `target_fingerprint`                               | 已核实隔离分支的 `neon_target_fingerprint`               |
| `production_fingerprint`                           | 独立只读核验 main 得到的目标摘要，用于拒绝生产目标       |
| `source_fingerprint`                               | 独立只读核验唯一恢复源得到的目标摘要，用于拒绝覆盖恢复源 |
| `expires_at`                                       | 新审批窗口的 UTC ISO 时间，未来最多一小时                |

五个指纹须为非占位的 64 位小写 SHA-256；R1/R2 不同；三个目标两两不同。
SQL 不验证审批者身份、仓库 SHA、CI、恢复源可靠性或分支拓扑，这些须由受保护线上流程
独立复核并绑定，不能把可自行设置的声明当作审批证明。不得复用已到期的旧生产采集审批。

目标摘要来自 `pg_settings` 中三个非空、`context = 'postmaster'` 的注册设置：
`neon.project_id`、`neon.branch_id`、`neon.timeline_id`，按照 SQL 内的 JSONB 编码计算。
**上游实现存在这些设置，不代表当前部署必然可读；本次未在线核验该能力。**
缺失、空值、权限不足或目标不匹配时拒绝执行；普通自定义 `SET neon.*` 不能通过注册检查。
服务端身份约束参考 [Neon 官方扩展源码](https://github.com/neondatabase/neon/blob/main/pgxn/neon/libpagestore.c)。
目标摘要不是“隔离”的证明，必须另在 Neon 核验父子关系与非生产身份。

## 事务、并发与失败处理

脚本采用一个 READ COMMITTED 事务，固定 search_path/时区和超时，取得与现有维护工具
相同的事务 advisory lock，锁定 Search 和 Topic 两张表，然后做前后有效权限与目录核对。
后置失败抛异常且不吞错，不能提交部分 REVOKE。发生错误后执行客户端必须停止并回滚/关闭
连接，不可“继续执行剩余语句”或手动提交。提交成功后仍需新的独立 R3 采集。

表锁会阻塞两张投影表的读写，所以只准在已审批的隔离目标测试。advisory lock 是协作锁，
不能阻止 provider 或不遵守协议的其它管理员修改全局角色、其它对象；运行窗口必须冻结
相关 DDL/ACL，执行后再独立复核。此脚本不声称可消除所有跨会话 TOCTOU 风险。

PostgreSQL 撤销最后一条列 ACL 会将空 `attacl` 置回 NULL；不需要直接修改系统目录。
参考 [PostgreSQL 18 官方 ACL 实现](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/catalog/aclchk.c)
和 [REVOKE 文档](https://www.postgresql.org/docs/18/sql-revoke.html)。如果 R1 本来是显式空数组
或存在其它差异，指纹仍可能不匹配；应停止审查，不能归一化掉差异以制造通过。

## 测试边界与后续门禁

- 静态测试核对唯一 REVOKE、十二列 allowlist、前后查询与只读采集完全一致、目标/超时/身份
  防护及无凭据、无批量恢复、无动态执行。通过不代表 SQL 已在 PostgreSQL 执行。
- `fts-acl-recovery.integration.test.mjs` 接入现有 `test:migrations`，只使用 CI 的一次性
  PostgreSQL 18，拒绝替换已有固定命名 fixture。未提供隔离环境时跳过。
- 原样脚本在普通 PostgreSQL 必须拒绝 Neon 身份缺失/伪造。事务核心测试仅在测试内移除
  Neon 专用身份片段，保留真实 owner/数据库/权限/事务防护，验证恢复、后置失败回滚等。
  这个明确的测试替换不进入发布 SQL；核心测试不是完整 Neon 成功路径验收。
- 仍需真实 Neon 身份能力核验、R1/R2 材料审查、外部独立 review、线上入口与新审批、
  隔离正反例演练、Runtime 自身登录和 R3 独立采集，之后才能讨论解除生产门禁。

操作者已决定不延长原演练分支。本次不改期限、不重置、不新建分支；原目标过期后，
后续演练必须重新核验并取得新目标的明确授权。
