# 来源与核查边界

核查日期：2026-11-18；用户时区 Europe/Berlin。`git fetch origin main` 确认主干为 `b80a9125044b845dae8d54cfcf7f5b6d1a5c3fd4`。本地 `d1e6add` 的应用代码与它一致。

## 历史观测

- [2026-11-17 原始来源清单](../2026-11-17-neon-egress/sources.md)：184 条公开信号，`content` 的 PostgreSQL JSON 文本长度合计 303,852 字节；不是网络协议或账单字节。
- [路由聚合](../2026-11-17-neon-egress/analysis/routes.csv)：11 月 17 日 04:31–16:31 Berlin，资源详情 550、人物详情 478，共 1,028 次 CDN 请求。请求数不等于 SQL 次数。
- [昨日分析](../2026-11-17-neon-egress/analysis/report.md)：778.94 MB 是 26 小时 21 分钟的采样区间；不能将它当作完整自然日或本次情景估算的分母。

## 本次线上检查

2026-11-18 09:02:24–09:02:25 UTC（Berlin 10:02），分别执行一次 `curl -sSI --max-time 20`：

| 地址                           | HTTP | Cache-Control                                             | X-Vercel-Cache | Age |
| ------------------------------ | ---: | --------------------------------------------------------- | -------------- | --: |
| `https://hzense.com/`          |  200 | `private, no-cache, no-store, max-age=0, must-revalidate` | MISS           |   0 |
| `https://hzense.com/resources` |  200 | 同上                                                      | MISS           |   0 |
| `https://hzense.com/signals`   |  200 | 同上                                                      | MISS           |   0 |

这三个 HEAD 样本只证明这些响应的缓存指令，不能据此推算全天缓存命中率、SQL 次数或今天用量。没有进行压测或密集探测。

## 代码证据

以下路径相对仓库根目录，行号对应上述应用基线：

- `apps/web/lib/server/resource-detail.ts:9`、`apps/web/lib/public-exploration-runtime.ts:12`、`apps/web/lib/seed-runtime.ts:35`、`apps/web/lib/unified-signal-reader-core.ts:12`：资源/人物详情进入全公开信号目录读取。
- `apps/web/lib/seed-runtime.ts:63`、`apps/web/lib/unified-signal-reader-core.ts:18`：信号详情已有按 ID 路径；旧名称记录仍可能回退目录。
- `apps/web/lib/server/editorial-signals.ts:40`、`apps/web/lib/unified-signal-reader-core.ts:139`：每次读取检查角色权限与就绪状态。
- `packages/database/src/unified-signal-contract.mjs:81`：统一 content 为标题、摘要、日期、类型、评分和关系等字段，不含导入文章全文。
- `apps/web/components/public-signal-cards.tsx:14`：卡片显示字段；`apps/web/lib/editorial-entity-links.ts:43`：全局唯一名称解析；`apps/web/lib/public-exploration-core.ts:325`：最新公开实体简介选取。
- `apps/web/lib/server/automation-insights.ts:33`：报告目录读取完整 result；`apps/web/lib/server/topic-insights.ts:6`、`apps/web/lib/topic-insight-core.ts:61`、`:226`：证据摘要、版本与完整报告校验。
- `apps/web/app/topics/[id]/editions/[edition]/page.tsx:16`、`apps/web/app/insights/[id]/page.tsx:48`：报告详情仍先读取全部信号。
- `apps/web/app/sitemap.ts:16`：全目录及报告读取；`apps/web/lib/server/search.ts:81`、`:104`：unified 搜索共享一次信号快照并在应用排名。
- `apps/web/app/page.tsx:15`、`apps/web/components/signal-radar.tsx:5`、`apps/web/lib/radar-window.ts:44`：雷达服务端读全量，客户端收到投影，支持全部时间范围。
- `apps/web/lib/visible-polling.ts:2`：常规后台轮询间隔 15 秒，隐藏暂停、不重叠。
- `packages/database/src/editorial-signal-role.mjs:197`：逐列有效 ACL 返回后在应用核对。

## 官方文档（本次读取）

- [React cache](https://react.dev/reference/react/cache)：缓存范围是单次服务端请求，不是跨访客共享缓存。
- [Next.js 非 Cache Components 缓存模型](https://nextjs.org/docs/app/guides/caching-without-cache-components)：动态渲染与非 fetch 数据缓存的区别。
- [Next.js revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)：`max` 使用过期内容再更新；`{ expire: 0 }` 不继续提供过期缓存。二者不等价。
- [Vercel Runtime Cache](https://vercel.com/docs/runtime-cache)：区域级、可驱逐的非持久缓存；与整页 CDN 缓存不同。当前项目是否迁入新版缓存基础设施未核实，因此本报告不假设具体适配器已经可用。

历史 PR #222 的优化范围也已对照当前代码复查。它的历史收益估算没有被当作今天的生产流量实测。
