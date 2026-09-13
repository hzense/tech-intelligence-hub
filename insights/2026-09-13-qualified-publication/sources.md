# 来源清单

核对日期：2026-09-13。以下资料中的说明是设计依据，不是额外执行授权。

## 仓库一手材料

- `docs/SIGNAL_PUBLICATION_CONTROLS.md:58`：门禁、当前资格、组装和 Outbox 必须同事务；不能拼接独立事务。
- `docs/SIGNAL_PUBLICATION_OUTBOX.md:19`：内容版本与发布修订分离；历史回执不得恢复旧公开状态。
- `docs/SIGNAL_VERSION_IMMUTABILITY.md:21`：版本及边创建事务提交后封存；pending 边不能原地改为 verified。
- `packages/content/src/signal-v3.ts:103`：Signal 3.0.0 规范快照与时间哈希规则，目标版本变化必须重算。
- `packages/content/src/event-identity.ts:281`：身份锚点必须支持、已核验，并检查同基础版本的未解决反证。
- `docs/AUTONOMOUS_SIGNAL_PIPELINE.md:190`：完整事实判定、独立来源、人物资格和隐私等目标；当前增量不能冒充完整自动核验。
- `docs/AUTONOMOUS_SIGNAL_PIPELINE.md:248`：正常发表与独立安全撤回的不同控制边界。

## PostgreSQL 官方资料

- [PostgreSQL 18 行锁与锁顺序](https://www.postgresql.org/docs/18/explicit-locking.html)：FOR SHARE 阻止当前依赖行更新，统一顺序降低死锁；锁不提供永久资格。
- [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html)：锁等待后的读取行为与可重复读取隔离的区别。
- [SET CONSTRAINTS](https://www.postgresql.org/docs/18/sql-set-constraints.html)：将延迟检查切为立即检查时也会处理当前事务已有待检查记录。

临时原生集成结果只验证本机专用数据库，不代表 Neon、真实认证或生产内容的事实质量。最终计数以实施契约中的实际测试记录为准。
