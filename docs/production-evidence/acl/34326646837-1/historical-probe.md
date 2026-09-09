# 历史分支只读取证 — 2026-09-09

## 来源与边界

经操作者要求，通过 Chrome 浏览器插件在 Neon SQL Editor 执行，未使用本地数据库连接。
目标为历史候选分支 `pre-topic-0002-20260831-0049z`，数据库 `hzense`；
通过页面分支路径和查询结果共同确认。本文是页面实际结果的摘录，不是完整 hosted baseline，
不替代本目录 `baseline.json`，也不声明历史缺口已经关闭。

两批查询均采用以下边界，查询结束后页面显示 `Connected (5 queries)`，
SELECT 分别返回 1 行和 8 行，包含最后的 ROLLBACK 结果页签：

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '15s';
-- SELECT catalog metadata / migration names only.
ROLLBACK;
```

上述代码仅说明事务边界，不是完整取证查询。SQL Editor History 对应标题为
`database health check with role and table validation`（页面时间 Sep 9, 2026 - 3:09pm）和
`database security audit with migrations check`（3:11pm）。标题/时间是定位线索，
不单独证明目标分支或事务结果；本文依据实际结果区记录。没有展开密码相关历史查询。

## 实际结果

第一组 SELECT 页面显示 161 ms，返回：

```json
{
  "database": "hzense",
  "read_only": "on",
  "current_user": "hzense_migrator",
  "session_user": "hzense_migrator",
  "runtime_exists": true,
  "topic_sync_exists": false,
  "migration_table_exists": true,
  "topic_columns": 5,
  "search_columns": 10,
  "runtime_role": {
    "login": true,
    "config": null,
    "inherit": false,
    "create_db": false,
    "superuser": false,
    "bypass_rls": false,
    "create_role": false,
    "connection_limit": 20
  }
}
```

`config: null` 指 `pg_roles.rolconfig`，未查询该历史分支全部 database-specific
role settings，不能据此断言任何会话都没有只读默认设置。

第二组 SELECT 页面显示 165 ms，返回 8 类结果：

| 类别                | 实际结果摘要                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| migrations          | `0000_foundation.sql`、`0001_radar_evidence.sql`，未包含 `0002` / `0003`                                    |
| database_acl        | `hzense` owner 为 Migrator，`datacl = NULL`；共返回五个数据库条目                                           |
| public_schema_acl   | owner 为 `pg_database_owner`，保留 PUBLIC USAGE；Migrator 有显式 USAGE/CREATE                               |
| runtime_memberships | 仅一条：`neondb_owner` 为 Runtime 的 member，grantor 为 `cloud_admin`，ADMIN=true、INHERIT=false、SET=false |
| public_relation_acl | 返回 13 个应用 relation，owner 全部为 Migrator，`relacl` 全部为 NULL                                        |
| explicit_column_acl | 空数组：该查询范围内没有非 NULL 的显式列 ACL                                                                |
| enum_acl            | 返回 9 个 public enum，owner 全部为 Migrator，`typacl` 全部为 NULL                                          |
| default_acl         | 仅两条 provider owner 的 public Schema 默认权限，未返回 Migrator 的默认权限行                               |

数据库 ACL 原始文本摘录：

| 数据库    | owner           | ACL 文本                                                                           |
| --------- | --------------- | ---------------------------------------------------------------------------------- |
| hzense    | hzense_migrator | NULL                                                                               |
| neondb    | neondb_owner    | `{=Tc/neondb_owner,neondb_owner=CTc/neondb_owner,neon_superuser=CTc/neondb_owner}` |
| postgres  | cloud_admin     | NULL                                                                               |
| template0 | cloud_admin     | `{=c/cloud_admin,cloud_admin=CTc/cloud_admin}`                                     |
| template1 | cloud_admin     | `{=c/cloud_admin,cloud_admin=CTc/cloud_admin}`                                     |

public Schema ACL：
`{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,hzense_migrator=UC/pg_database_owner}`。

13 个 relation：`content_registry`、`entities`、`entity_topics`、
`hzense_schema_migrations`、`radar_snapshot_signals`、`radar_snapshots`、`relations`、
`search_documents`、`signal_entities`、`signal_topics`、`signals`、`sources`、`topics`。

9 个 enum：`entity_type`、`maturity`、`radar_domain`、`signal_status`、`signal_type`、
`source_type`、`strategic_value`、`topic_status`、`trend`。

两条默认权限均属于 `cloud_admin`，namespace 为 `public`：

- Sequence (`S`)：`{neon_superuser=r*w*U*/cloud_admin}`。
- Relation (`r`)：`{neon_superuser=a*r*w*d*D*x*t*m*/cloud_admin}`。

NULL ACL 表示使用该对象类型的默认权限，不能解读为“所有角色都无权限”。
本次未计算完整有效权限矩阵、全部角色图、非 public 对象或 routine 的完整历史基线，
也未证明旧分叉点与后续 normalization 之间不存在其它变更。

## 演练分支期限复核

另在分支列表准确选中 `fts1-restore-rehearsal-20260908` 的 Update expiration，
对话框显示：启用到期，**2026-09-09 16:12，Europe/Berlin (GMT+02:00)**。
该子分支的 parent 仍显示 `pre-fts1-recovery-20260908`。
本次只查看并点击 Cancel，没有点击 Confirm，没有修改保留设置。

操作者随后明确“不用延长演练分支了”，因此不修改期限，本次也未新建、重置或删除分支。
若后续演练时原目标已过期，必须重新核验并单独确认新目标，不能套用旧授权。

## 结论

浏览器连接已恢复，历史内部取证已从“仅看到分支”推进到实际只读 catalog 结果。
该分支可证明一个 pre-Topic-0002 的早期状态，但不能直接当作当前恢复 SQL 的目标状态：
恢复旧 PUBLIC/default ACL 可能重新放开当前已收紧的权限，且会丢失后续 Topic sync 合约。
历史缺口处理、恢复 SQL 的真实基线适配与独立审核、隔离演练和生产写门禁仍未完成；
另已开发受限恢复候选，参见[恢复方案](./recovery-plan.md)，不改变本历史探查结论。
