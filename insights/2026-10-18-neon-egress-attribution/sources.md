# 来源清单

核对日期：2026-10-18；代码基线 `377fd83eeeac0d66ecdb39be9bad2d7bd3e46e4e`。

## 一手平台资料

1. [Neon：Reduce network transfer costs](https://neon.com/docs/introduction/network-transfer)
   - 公网出站的计量、重复查询与大结果集、导出和复制的影响。
   - 不提供 per-query / per-connection 网络流量明细。
   - 免费计划可读项目/分支累计值；付费 Consumption API 提供时间粒度统计。
2. Neon 控制台：项目总览及 Monitoring → Query performance。
   - 当前账期 2026-10-01 至 2026-11-01；累计 5.53 GB；显示月网络传输额度耗尽。
   - 查询性能页未取得可用 SQL 统计，不将空白/加载状态解释为没有查询。
3. Vercel 认证只读查询：正式域名 alias 及 deployment。
   - 当前正式域名绑定 Production READY 的 `377fd83` 部署。
   - 本月日志查询因 Hobby 保留范围受拒；近期日志不构成月度网络流量样本。

## 当前代码证据

- `apps/web/app/page.tsx:7`、`apps/web/app/signals/page.tsx:7`：动态页面及公开目录入口。
- `apps/web/lib/public-exploration-runtime.ts:12`：整批信号参与目录与资源聚合。
- `apps/web/lib/seed-runtime.ts:29`：React 缓存只限同次 render；`:59` 为详情 ID 查询和旧姓名兼容分支。
- `apps/web/lib/unified-signal-reader-core.ts:9`：目录包含完整 content；详情按 ID，probe 最多一条。
- `apps/web/lib/server/unified-signals.ts:11`：就绪与内容共用连接及新 ACL 校验。
- `apps/web/lib/server/search.ts:79`、`apps/web/lib/search-runtime.ts:270`：统一模式搜索读取快照。
- `apps/web/lib/server/automation-insights.ts:33`：已发布洞察读取完整 result（受功能开关影响）。
- `packages/database/src/editorial-vector-query.mjs:35`：数据库内比较 manifest，返回布尔值。
- `apps/web/components/generation-live-detail.tsx:37`：活跃生成任务每 5 秒按 ID 查询。
- `packages/database/src/signal-generation-store.mjs:16`、`:472`：读取列含 snapshot，run 查询使用该列清单。
- `apps/web/lib/signal-generation-core.ts:121`：前端 DTO 排除原文不等于 SQL 没取原文。
- `apps/web/lib/signal-generation-core.ts:189`、`:223`：创建时将 buildGenerationSource 结果放入 snapshot.source。
- `apps/web/lib/signal-generation-core.ts:269`、`:333`：执行前后读取原文。
- `packages/database/src/import-store.mjs:484`：按 owner/batch/item 检查并读取解析正文 content。
- `apps/web/components/admin-automation.tsx:490`：有活跃任务、页面可见等条件下 5 秒 dashboard 轮询。
- `packages/database/src/automation-store.mjs:24`、`:150`：dashboard 最近 100 个 run 含 snapshot/result/frozen_inputs。
- `.github/workflows/production-health.yml:5`：每小时健康检查计划（受远端开关控制）。
- `packages/ingestion/src/signal-generation-contract.mjs:9`：source 的 token/JSON 字节独立限制。
- `packages/database/src/signal-generation-store.mjs:387`、`:841`：snapshot 与 result 写入时的紧凑 JSON 字节限制，不是网络计量上限。
- `apps/web/lib/server/signal-generation.ts:114`、`:178` 及 `apps/web/lib/generation-publication.ts:93`：详情响应还读取名称，完成任务另读发布回执，不能把单条 run 的大小当成整次请求总量。

## 历史变更

- [PR #222](https://github.com/hzense/tech-intelligence-hub/pull/222)，合并提交 `9321480ae886e5f14427ac0f6168eba641c4414d`：公开信号读取和 ACL 元数据出站优化；当前代码已包含。

## 重核方法

只读检查上述文件、当前正式域名部署 SHA、Neon 用量/查询性能页和可访问的运行日志。不同时间的累计指标不能直接相减为页面归因；查询行数也不等同于字节。本次未运行生产 SQL、重置统计、升级套餐或调整开关。
