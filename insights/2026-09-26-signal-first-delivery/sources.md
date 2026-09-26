# 来源

- 产品基线：`docs/SIGNAL_FIRST_REDESIGN.md`。
- 最新发布规则：`docs/EDITORIAL_PUBLICATION.md`；用户明确采用四项齐全后人工确认发布，优先于旧自动发表设计。
- 读取门面：`apps/web/lib/seed-runtime.ts` 的 `getSignalEntries`；保留既有 legacy/database 模式及管理员确认记录，不切换生产数据源。
- 公开投影：`apps/web/lib/server/public-signals.ts`、`editorial-signals.ts`。
- 既有持久任务：`apps/web/lib/server/import-service.ts`、`signal-generation.ts`、`apps/web/workflows/`。
- 发布基线：PR #166，`54c402b`；main CI 36196152415、生产健康 36196343321 均成功（2026-09-26 核对）。

来源仅用于方案依据；代码完成、生产迁移、模型调用、公开发布是独立验收。
