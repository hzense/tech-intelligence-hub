# 单次轮询量级：示例计算

目标：解释每 5 秒查询的累积效果，不推断生产环境单次平均值或月度占比。

输入全部是人工指定的假设，不来自生产样本，因此不适用缺失率、分位数或置信区间。单位使用十进制：1 kB = 1,000 字节，1 MB = 1,000,000 字节。

字段：`hypotheticalBytesPerPoll` 是假设一次轮询对应的数据库返回字节总量；`polls` 是理想化调用次数；`illustrativeTotalMB` 是累计返回量。忽略响应耗时，按 300 秒 / 5 秒 = 60 次计算。实际生成页面使用响应完成后再等待 5 秒的方式，次数可能更少；多个任务或页面会叠加。

运行：`node insights/2026-10-18-neon-egress-attribution/analysis/synthetic-poll-cost.mjs`，无依赖、无需网络，耗时小于一秒。结果与局限见 [report.md](report.md)。仅做三行确定性计算，不制作图表。
