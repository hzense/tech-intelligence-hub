# 设计依据

- `apps/web/lib/server/candidate-enrichment.ts`：现有补全只读取原任务快照，不能自动从新增来源补人物。
- `packages/ingestion/src/signal-generation-contract.mjs`：片段连续编号、输入大小和逐字引用约束。
- `packages/database/src/candidate-review-contract.mjs`：审核始终绑定原候选材料哈希。
- `packages/database/src/candidate-review-role.mjs`：审核角色没有实体或公开证据写入权限。
- `packages/database/src/signed-candidate-verification.mjs`：既有信号核验采用独立 Ed25519 签名，网页仅持公钥。
- `db/migrations/0007_signal_version_immutability.sql`：公开证据正文封存，仅核验状态可以后续改变。
- `docs/CANDIDATE_REVIEW.md`：管理员确认与独立核验、公开发布不是同一件事。

本次通用开发不将当前单条候选网页检索结果写入生产或固化为通用规则。
