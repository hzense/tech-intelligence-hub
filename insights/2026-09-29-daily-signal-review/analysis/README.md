# 复跑说明

本批先有 28 条获用户确认，随后在 2026-09-30 接受剩余 11 条，合计 39 条全部确认。`summarize.mjs` 合并本批 `publication.json` 与 `../../2026-09-30-signal-acceptance/publication.json` 的逐条决定，并对 5 条信号采用补全修订稿；不覆盖任何原始账本或候选快照。两个原始候选 YAML 及 `review-results.json` 保持确认前状态，不应把其中的 `inbox` 解读为仍待审。审核结果只是历史决定，脚本没有生产发布或部署核验能力。

使用项目 Node 24 和已安装的依赖，不连接生产库，不调用付费模型。

在仓库根执行：

```sh
node insights/2026-09-29-daily-signal-review/analysis/audit.mjs inventory ../datas/日报
node insights/2026-09-29-daily-signal-review/analysis/audit.mjs
pnpm seed:validate
node insights/2026-09-29-daily-signal-review/analysis/summarize.mjs
node insights/2026-09-29-daily-signal-review/analysis/summarize.mjs markdown
pnpm --filter @hzense/content test
```

第一条输出输入清单 JSON；第二条输出当前 Seed 计数及人物／组织缺口。脚本仅向标准输出写结果，不自动覆盖证据快照。

`summarize.mjs` 输出差异与空缺字段统计，`markdown` 参数输出候选表格。机构事件或作者研究按类型规则已获确认后，仍可存在人物／组织空值；字段空缺不等于待审核。它比较本轮 `existing-before.json` 与执行时的本地 Seed；如果后续正式目录已更新，其输出当然可能不同于当日 `review-results.json`。这不是生产数据库查询。已归档的候选 schema 测试则使用 `catalog-context.yaml` 静态上下文，不把未来正常晋升、日期更正或实体改名当作历史研究失败。

`input-manifest.json` 是本次输入指纹。`matched_existing_signals` 只是去掉域名前缀、查询串及末尾斜杠后的字面 URL 匹配，用于提示复用；不是语义去重，不代表该简报原文的全部内容均已被 Signal 覆盖。`technology_section_headings` 只是全文检索导航，人工覆盖记录另见两个时段研究文件。

领域分类由 `classifications.yaml` 的逐条语义决定提供，不使用关键词直接修改正式数据。所有计数为有限目录的实数盘点，不是抽样推断，因此不提供统计置信区间。
