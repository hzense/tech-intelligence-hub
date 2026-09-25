# 依据

- 当前用户明确确认“人工确认后直接发布”，四项条件为日期、组织、人物、领域；缺项可手动补充。
- `apps/web/lib/candidate-review.ts`：私有候选、原文绑定和原始材料指纹。
- `apps/web/lib/server/material-registration.ts`：已有补证结果，仅作为四项表单预填，不冒充核验。
- `packages/database/src/editorial-signal-contract.mjs` 与 `editorial-signal-store.mjs`：服务端字段契约、归属、幂等、并发和修订持久化。
- `db/migrations/0025_editorial_signal_publication.sql`：独立追加记录及去私有标识的公开视图。
- `apps/web/lib/server/search.ts`：公开搜索只取当前可见 Signal，防止旧索引恢复撤回内容。

上述是代码和本次需求依据，不是外部事实核验或生产执行证据。
