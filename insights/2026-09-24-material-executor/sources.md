# 来源

- [事实] `packages/database/src/material-registration-contract.mjs`：签名材料协议、六项核验和最长 60 秒摄入窗口。
- [事实] `apps/web/lib/server/material-registration.ts`：owner 绑定、原候选快照、报告接收和登记事务。
- [事实] `packages/database/src/material-verification-worker.mjs`：独立复查、人工确认材料、实时原文与 Ed25519 签名。
- [事实] `.github/scripts/production-maintenance.mjs`：固定迁移清单及单次执行授权，不复用旧批准。
- [事实] [只读预检 36022413674](https://github.com/hzense/tech-intelligence-hub/actions/runs/36022413674)：2026-09-24 成功，旧 main 下 pendingMigrationCount=1；尚未含本批 0024。
- [事实] [GitHub workflow dispatch 文档](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)：调用受限工作流需要 Actions write 权限；生产配置须另行确认。

没有将任何真实候选正文、用户身份、凭据或完整导出写入本文档。
