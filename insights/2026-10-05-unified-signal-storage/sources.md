# 来源

以下均为 2026-10-05 本地代码核对，不能单凭这些文件推断生产运行状态。

- `docs/INFORMATION_MODEL.md:1302`：原 Signal 主表为 signals。
- `db/migrations/0004_signal_version_foundation.sql`：3.0.0 快照、强制评分和关系约束。
- `db/migrations/0007_signal_version_immutability.sql`：版本事务封存及禁止改写边界。
- `db/migrations/0025_editorial_signal_publication.sql`：人工修订历史及基于最新修订的公开视图。
- `packages/database/src/editorial-signal-store.mjs`：幂等、锁、并发版本、合法发布／撤回顺序。
- `packages/database/src/editorial-signal-contract.mjs`：现行标题／摘要、日期、人物组织和领域规则。
- `db/migrations/0028_legacy_signal_archive.sql`：历史原始记录、引用、投影归档。
- `packages/database/src/legacy-signal-archive.mjs`：冻结清单和逐条摘要对账。
- `apps/web/lib/seed-runtime.ts`：当前按模式选择分散来源，尚非统一物理写入。
- `packages/database/test/unified-signal-plan.test.mjs`、`unified-signal-preflight.test.mjs`：本批可重复合成验证；不是生产验收。
- `db/migrations/0029_unified_signal_storage.sql`：阶段 B 的分支结构、封印兼容、指针及写入保护。
- `packages/database/test/unified-signal-storage.integration.test.mjs`：定向隔离 PostgreSQL 验证，非生产数据；no-vector 明确不覆盖 FTS。
- `packages/database/test/signal-qualified-publication.integration.test.mjs`：真实旧发布链升级回归，待完整环境执行。
- [PostgreSQL 18 Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)：CHECK 的 NULL 语义、非空及复合外键（2026-10-05 查阅）。
- [PostgreSQL 18 CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)：延迟约束触发器（2026-10-05 查阅）。
