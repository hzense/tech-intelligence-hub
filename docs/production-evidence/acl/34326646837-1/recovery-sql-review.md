# FTS ACL 恢复候选：代码自审 — 2026-09-09

结论：**已完成候选开发与静态自审，可进入 PR/CI 和独立审核；尚不批准执行。**
本报告由实现者自审，不冒充外部 reviewer 批准，也不是恢复演练证据。

## 审查对象

- [恢复 SQL](../../../../db/roles/restore_fts_reader_acl.sql)：单事务、单条十二列 REVOKE。
- [只读状态摘要](../../../../db/roles/fts_acl_recovery_state.sql)：为同一分支 R1/R2/R3 提供新格式指纹。
- [设计边界](../../../../db/roles/README.fts-acl-recovery.md)：输入、并发限制、目标绑定及测试替换说明。
- [静态测试](../../../../packages/database/test/fts-acl-recovery.test.mjs)与
  [PostgreSQL 核心集成测试](../../../../packages/database/test/fts-acl-recovery.integration.test.mjs)。

## 审查结果

| 风险                                           | 处理与限制                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main 与隔离副本数据库同名，误操作生产          | 核验服务端注册且只在启动时可设的 Neon 项目/分支/timeline 摘要，并排除声明的生产与恢复源摘要。仍需受保护入口独立核验拓扑及声明来源；线上设置可读性尚未验证 |
| 把整个前向 normalization 当成十二列 GRANT      | 必须先审核真实 R1/R2 差异；执行前匹配 R2，执行后匹配 R1，额外变化导致异常，不进行全库权限重建                                                             |
| 表级、PUBLIC、继承或 grant option 使列撤销失效 | 核对有效 Search/Topic 表列权限、Runtime 成员关系与直接 owner grant，显式 RESTRICT，不使用 CASCADE                                                         |
| Topic、其它角色或 provider 权限被误改          | 唯一修改目标是 Runtime 的 Search 十二列；前后固定范围目录指纹保留其它 ACL、grantor 与 NULL/显式状态                                                       |
| DDL 事件触发器带来额外副作用                   | 拒绝存在启用事件触发器的目标；如果真实 Neon 有此类 provider 机制，应暂停另审，不删除机制以通过检查                                                        |
| REVOKE 后校验失败却部分提交                    | 前后两次检查在同一事务，抛异常而不捕获；集成测试包含错误后置指纹和回滚验证，但该集成测试本次尚未实跑                                                      |
| 普通 PostgreSQL 的测试伪装成 Neon 演练         | 原样 SQL 测试身份缺失时拒绝；仅核心测试在测试文件中替换 Neon guard，发布 SQL 无绕过入口，结果不得计作 Neon 成功路径                                       |
| 并发管理员或 provider 操作                     | advisory lock + 两表排他锁不等于全局冻结；必须另行冻结 DDL/ACL 并在提交后独立采集，残余 TOCTOU 风险未消除                                                 |

自审中补充了 Topic 表级权限拒绝、事件触发器拒绝、固定 UTC、精确目标声明及测试边界说明。
未发现静态范围内仍需放宽权限才能工作的设计；是否可实际运行仍以 CI 与隔离实测为准。

## 本次验证证据

- `pnpm --filter @hzense/database test`：**377 passed，48 skipped**；
  其中新增静态测试 6 项通过，新增 PostgreSQL 集成测试 13 项因没有隔离连接而跳过。
- `pnpm --filter @hzense/database lint`：通过。
- `pnpm --filter @hzense/database typecheck`：通过。
- `git diff --check`：通过。
- 原始 `baseline.json` 未改写，SHA-256 仍为
  `225815bd5317c8497f8b05076d311c651eaad12375c66bd22e7a424eab454c38`。

没有安装或启动本地数据库，没有使用生产凭据、连接 Neon、修改线上权限或发布配置。
以上为提交前的本地验证检查点；后续提交、PR 与线上 CI 状态以 GitHub 实际记录为准，
不能把本节测试结果视为远端 CI 通过。

## 仍然阻止执行的事项

1. 在 PR 的一次性 PostgreSQL 18 CI 环境实跑新增集成测试；测试 fixture 不是生产完整 schema。
2. 确认实际 Neon 部署能提供可信目标摘要；保存真实同分支 R1/R2 完整 ACL 并审核差异。
3. 完成外部独立 review 与受保护线上恢复入口；输入指纹和到期时间不能自证审批。
4. 重新确认可用隔离目标、备份与执行窗口并取得授权，随后做正反例演练、Runtime 自身登录
   和独立 R3 采集。操作者已拒绝延长原分支，本次没有新建、重置或延长分支。
5. 历史 ACL 证据缺口仍开放，不用本次 SQL 或单元测试替代缺失证据或操作者风险接受。

在上述事项完成前，不设置 `aclRecoveryReviewed` / `restoreRehearsed`，不解除生产写门禁。
