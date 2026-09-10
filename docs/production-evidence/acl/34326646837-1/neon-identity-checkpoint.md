# Neon 恢复源身份核验 — 2026-09-09

## 结论与范围

**恢复源的可信 Neon 身份参数已实测可读；R1/R2 差异、独立审核和隔离恢复演练仍未完成。**
本次是浏览器 SQL Editor 的只读检查，不是 hosted 双采集，不是 R0/R1/R2/R3 基线，
也不是执行批准或 `restoreEvidenceFingerprint`。没有新建、重置、延长分支，
没有执行迁移、GRANT/REVOKE、回填或搜索切换，没有更改凭据或线上配置。

## 代码与线上入口

- [PR #53](https://github.com/hzense/tech-intelligence-hub/pull/53) 已合并，
  合并提交为 `23ed839f17d1f2d36157442c97de0898be94352c`；本次回读远端 main 与本地一致。
- 同一 SHA 的 [main CI 34368875223](https://github.com/hzense/tech-intelligence-hub/actions/runs/34368875223)
  已完成，`foundation`、`database-migrations`、`daily-publication-gate` 均为 success。
- PR 的现有评价仍是作者账号 `zhenghu` 的 `COMMENTED`，不是独立审批。
- GitHub `production-maintenance` Environment 存在 required reviewer 和自定义分支策略；
  环境存在不等于本次恢复操作已获批。本次未读取 secret 值，也未触发运行。
- 当前 `production-maintenance.yml` 只有 `preflight`、`migrate`、`verify`、
  `search-dry-run`、`search-apply`、`runtime-preflight`、`acl-capture`；
  没有隔离恢复或恢复态 Runtime 验证入口。不得通过生产入口替换目标或运行任意 SQL。

审核代码的 SHA-256：

- `restore_fts_reader_acl.sql`：`1fcdb0593086d06d75eeaa80ed8e32173d9adea2e29b8b3d4a73d589f370d8c5`
- `fts_acl_recovery_state.sql`：`1b44fbef5352607789ce66af94ccdd0086c4306fd4d16f2a995e4f5d7dfdec0e`

## 实际分支与查询结果

Neon 网页分支列表显示 5 / 10，包含 main、`pre-fts1-20260906`、
`pre-fts1-recovery-20260908`、`pre-fts1-release-20260908`、
`pre-topic-0002-20260831-0049z`。原 `fts1-restore-rehearsal-20260908` 不在列表中。
此前确认的到期时间是 2026-09-09 16:12（Europe/Berlin）；本次检查已过该时间。
列表缺失与到期相符，但本次没有取得 provider 删除事件，不能断言删除原因。

只读查询于 2026-09-09 18:07（Europe/Berlin）在恢复源
`pre-fts1-recovery-20260908` 的 `hzense` 数据库执行。SQL Editor 显示 6 条语句执行完成，
SELECT 返回一行，ROLLBACK 成功；以下为结果逐字段抄录，不是根据脚本预期推断。

| 字段                      | 实际值                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| database_name             | hzense                                                             |
| authenticated_role        | hzense_migrator                                                    |
| direct_login              | t                                                                  |
| read_only                 | on                                                                 |
| server_version_num        | 180006                                                             |
| identity_settings_found   | 3                                                                  |
| trusted_identity_settings | 3                                                                  |
| target_fingerprint        | `83124bef465de1157b7d2510692ae5120e9845f03d53014c498a7dc7cc075795` |
| search_columns            | 10                                                                 |
| enabled_event_triggers    | 0                                                                  |

该摘要绑定的是**恢复源**，不能当作隔离目标摘要。恢复源仍有 10 个 Search 列，
本次没有采集迁移记录或完整 ACL，不能用此计数替代完整结构/权限验收。
在该恢复源上三项身份参数均为非空且 `context = 'postmaster'`，解决了候选 SQL 的一项
实际可用性疑问；新隔离目标和生产排除摘要仍须独立核验，不可直接沿用此结论。

### 实际执行的只读 SQL

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT
  current_database() AS database_name,
  current_user AS authenticated_role,
  session_user = current_user AS direct_login,
  current_setting('transaction_read_only') AS read_only,
  current_setting('server_version_num') AS server_version_num,
  (SELECT count(*) FROM pg_settings
   WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id'))
    AS identity_settings_found,
  (SELECT count(*) FROM pg_settings
   WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id')
     AND context = 'postmaster' AND setting <> '')
    AS trusted_identity_settings,
  (SELECT CASE WHEN count(*) = 3
      AND bool_and(context = 'postmaster' AND setting <> '')
    THEN encode(sha256(convert_to(
      jsonb_object_agg(name, setting ORDER BY name)::text, 'UTF8')), 'hex')
    ELSE NULL END
   FROM pg_settings
   WHERE name IN ('neon.project_id', 'neon.branch_id', 'neon.timeline_id'))
    AS target_fingerprint,
  (SELECT count(*) FROM pg_attribute
   WHERE attrelid = to_regclass('public.search_documents')
     AND attnum > 0 AND NOT attisdropped) AS search_columns,
  (SELECT count(*) FROM pg_event_trigger WHERE evtenabled <> 'D')
    AS enabled_event_triggers;
ROLLBACK;
```

## 下一步与仍未满足的门禁

1. 取得新隔离分支的准确目标授权后，重新核验拓扑、身份和保留窗口，再独立采集 R0。
   尊重操作者不延长原分支的决定，不静默重建旧目标，也不在唯一恢复源上制造 R1/R2。
2. 仅在获批隔离目标上分别执行迁移与前向配置，完整采集并审核真实 R1 → R2 差异。
   若变化不止十二列 SELECT，现有限制性恢复 SQL 不适用，须暂停重新设计。
3. 独立 review、受保护的线上恢复态验证入口及历史缺口处理仍待完成。
   新入口必须绑定准确隔离目标、排除 main 和恢复源、校验新鲜 SHA/CI/审批，
   且使用 Runtime 自身登录进行恢复态验证，不能降低现有生产预检标准。
4. 前述条件满足后方可申请恢复执行，并用独立 R3 验收；本次没有生成任何通过声明。

历史缺口保持[历史取证结论](./historical-probe.md)，不把本次当前态查询当作补齐历史。
原始 `baseline.json` 未修改，SHA-256 仍为
`225815bd5317c8497f8b05076d311c651eaad12375c66bd22e7a424eab454c38`。
