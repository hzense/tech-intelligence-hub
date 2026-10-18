# 单次状态查询有多大

核查日期：2026-10-18。没有取得生产查询字节样本，因此单次实际值、均值和 P95 均未知。

以下代码事实及示例对应优化前的 `377fd83` 基线，不代表后续小字段轮询的查询内容。后续实现与验证见 [进展看板](../../../docs/PROGRESS.md)。

## 代码事实

- 单个生成任务查询返回 `snapshot,configuration,result` 等列，不是只有状态；见 `packages/database/src/signal-generation-store.mjs:16`、`:472`。
- 当前生成资料限制同时检查 100,000 tokens 和 1,000,000 字节的 source JSON；这两种限制独立，不能按固定比例换算。见 `packages/ingestion/src/signal-generation-contract.mjs:9`。
- 创建时整个 snapshot 的紧凑 JSON 限制是 1,200,000 字节，保存 result 的限制是 512,000 字节。见 `packages/database/src/signal-generation-store.mjs:387`、`:841`。这些是字段校验阈值，不是正常任务平均大小，也不是完整 API 请求的流量上限。
- `generationDetail` 还调用 `historyDtos` 获取资料名称；完成的任务另读发布回执，运行中通常不读回执。连接也涉及权限核验，一次浏览器请求可能执行多条 SQL。见 `apps/web/lib/server/signal-generation.ts:114`、`:178` 及 `apps/web/lib/generation-publication.ts:93`。
- 浏览器最终 DTO 移除原文，不会抵消已经发生的 Neon 到服务器的数据传输。

## 示例计算，非生产实测

假设一次轮询全部数据库返回量如下，在单页面、单任务持续轮询 5 分钟、忽略响应耗时的场景中：

| 假设每次返回量 | 约 60 次累计量 |
| -------------- | -------------- |
| 100 kB         | 6 MB           |
| 500 kB         | 30 MB          |
| 1 MB           | 60 MB          |

这些场景不是当前实际任务的最小值、平均值或最大值。当前返回量必须结合具体任务原文、配置、结果及其他 SQL 查询才能计算。后台列表刷新可能读取多条任务，公开页面读取整个目录，也不能套用此处的单任务数值。

## 局限与下一步

JSON 字节数只是可复现的应用层近似，PostgreSQL JSONB 的输出格式、协议、连接握手与其他查询会影响传输量；不能把写入校验阈值当成 Neon 精确计费字节。数据库恢复后可只读统计具体记录各字段的输出字节，再按操作次数估算；没有生产采样前，不应给出“当前每次固定消耗多少”的结论。

复现脚本：[synthetic-poll-cost.mjs](synthetic-poll-cost.mjs)。本次只补充分析材料，未修改业务代码或生产配置。
