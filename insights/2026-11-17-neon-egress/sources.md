# 证据来源

采集日期：2026-11-17；业务日期采用 Europe/Berlin（当日 UTC+01:00）。代码基线：main `b4df265`。网页观察经浏览器登录读取，数据文件为人工转录的脱敏聚合值，不含正文、身份、密钥或连接串。

## 线上事实

1. [HZense Dashboard](https://hzense.com/admin/dashboard)：最后用量采样 11/17 14:10；月累计 4.24 GB，配置额度 5 GB；历史日行均显示“部分区间”。`daily.csv` 保留日期标签和实际起止时间。MB 使用页面显示的十进制数值，精确到 0.01 MB。
2. GitHub 用量采样：成功运行 [43793520293](https://github.com/hzense/tech-intelligence-hub/actions/runs/43793520293) 创建于 11/16 02:39:44Z；[44021032128](https://github.com/hzense/tech-intelligence-hub/actions/runs/44021032128) 创建于 11/17 05:00:33Z。定时触发的实际启动晚于午夜。
3. [Vercel CDN Requests](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/observability/cdn-requests)：Production，11/17 04:31–16:31 Berlin，约 2.5K 请求。`routes.csv` 只记录路由表第一页；`bots.csv` 记录已识别机器人表。它们是同一窗口的两种分组，不能相加为总请求。免费界面仅可查看最近 12 小时，未获取昨天全天请求数据。
4. Neon SQL Editor：在生产 main 的 hzense 数据库执行只读聚合 SELECT。11/17 约 16:27 Berlin，公开信号 184 条，`sum(octet_length(content::text))` 为 303852 字节；可见生成任务 118 个，snapshot 总 3409355 字节，result 总 423733 字节，最大 snapshot 96182 字节。该字节量是 JSON 文本长度，不是实际数据库协议或计费流量。
5. 同一次数据库核查按 `created_at` 的 Berlin 日期统计生成、导入、采集、补全和发布动作，见 `activity.csv`。终态是查询时状态，不是历史时点重放；发布动作为动作数量，不是去重信号数量。测量跨日窗口使用页面展示到分钟的边界，可能有秒级误差。
6. 数据库未安装 `pg_stat_statements`；查询时 compute 于 11/17 15:23:57Z 启动。Vercel 运行日志接口拒绝查询昨天，返回该套餐仅支持 1 小时回看。因此没有昨天 SQL 次数或调用方字节归因。

## 代码证据

- `apps/web/lib/neon-usage-core.ts:197`：午夜附近 ±1.5 小时基线，缺失时使用部分区间。
- `.github/workflows/neon-usage.yml`：22/23 UTC 候选 cron，根据 Berlin 时区选取；调用控制面统计 API。
- `apps/web/app/resources/[id]/page.tsx:7`、`apps/web/app/persons/[id]/page.tsx:7`：force-dynamic，元信息和详情使用公开实体目录。
- `apps/web/lib/server/resource-detail.ts:9` → `apps/web/lib/public-exploration-runtime.ts:12` → `apps/web/lib/seed-runtime.ts:33`：获取整个公开信号集合；React cache 仅在一次服务端渲染内去重。
- `apps/web/lib/unified-signal-reader-core.ts:12`、`:148`：全量列表选择完整 `u.content`；LIMIT 是安全上限，不是按实体筛选。
- `apps/web/lib/server/automation-insights.ts:13`：已发布洞察报告读取完整结果，也是可优化的附加路径。
- `packages/database/src/signal-generation-store.mjs` 中 `run`、`updateProgress`、`finish`：任务状态转换会重复读取 snapshot/result；这是固定阶段开销，不等于所有轮询都返回正文。
- `apps/web/lib/visible-polling.ts` 与生成 progress 查询：常规轮询已有 15 秒间隔、隐藏页面暂停和小字段投影，不应沿用“每 5 秒全量读取”的旧归因。

## 官方统计定义

- [Neon API OpenAPI 定义](https://github.com/neondatabase/neon-api-python/blob/main/v2.json)：`data_transfer_bytes` 是计费周期内从 Neon 向客户端的网络传输累计量，可能延迟，周期边界重置。
- [Neon 消耗指标文档源码](https://github.com/neondatabase/website/blob/main/content/docs/guides/consumption-metrics.md)：提供项目/分支的消耗指标口径。

数据库到 Vercel 的响应属于这项用量；浏览器图片下载量、上传文件大小、OpenRouter 调用费用不能直接作为 Neon 流量解释。
