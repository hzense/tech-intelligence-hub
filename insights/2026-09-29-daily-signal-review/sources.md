# 来源与证据索引

## 本地依据

- [事实] `../datas/日报/` 是用户指定材料目录的实际位置；全量文件指纹见 `input-manifest.json`，不复制全文。
- [事实] `data/seed/signals.yaml` 是本批现有记录基线（71 条）；`data/taxonomy/taxonomy.yaml` 是领域唯一权威，`data/seed/topics.yaml` 是可用投影。
- [事实] `packages/content/src/seed.ts` 定义 Seed 字段、枚举与引用校验；`apps/web/lib/legacy-signal-projection.ts` 只公开历史 `accepted/reviewed`，不把新候选自动升级为已发布。
- [事实] `docs/content-intake/2026-09-11-datas/` 是上轮提取与补源的历史台账，仅用于去重与追溯，不把旧的“未核实”自动改为通过。
- [事实] 开始时已有 Jakub Pachocki 的本地补充及对应 `2026-09-28-source-entity-audit.md` 改动，本批保留；其角色不是报告署名作者。

## 网上核验

分时段研究和实体复审文件逐条列出 URL、日期、事实支持、人物／组织角色与局限。39 条候选全部有 `reviews`，与 Signal ID 一一对应，保留 `local_refs`、`evidence_urls`、`date_basis`、`limitations`、`scores_reason` 和 `readiness`。原始引用分别见 [7–8 月研究](july-august-review.md)、[9 月研究](september-review.md)、[既有实体复审](existing-entities-review.md)。本文件仅集中补充集成阶段的新核验，不重复转抄所有源文。

- [事实] 主审补核 SoftBank [2026 财年第一季度财报 PDF](https://group.softbank/media/Project/sbg/sbg/pdf/ir/financials/financial_reports/financial-report_q1fy2026_01_en.pdf)，第 1 页标明 2026-08-06，第 5–6 页（PDF 页序）载明季度及 7 月各向 OpenAI 追加 100 亿美元。人物依据为 [CFO Yoshimitsu Goto 的官方业绩要点](https://group.softbank/en/news/webcast/20260806_02)。用精确 PDF 替换可变的演示列表 URL；不把估值收益当现金收入。
- [事实] 主审补核 [OpenAI 的 PORTS-Pike 原公告](https://openai.com/index/openai-joins-ports-pike-project/)，2026-08-17，正文明确 SB Energy 的建设／拥有／运营与 20 年租约、NVIDIA 的基础设施与信用支持、美国能源部的场地合作。补既有 Signal，不把多个阶段传闻重新计成新增交易。
- [事实] 长鑫与宇树上市分别用[上交所长鑫公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260724_10826610.shtml)和[上交所宇树公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260818_10829204.shtml)。两份静态正文支持起始交易日；发行价由候选 `evidence_urls` 中的发行人披露 PDF 交叉核对，动态空表不作为凭证。
- [事实] [ClusterMAX 3.0 原文](https://newsletter.semianalysis.com/p/clustermax-30-the-industry-standard)的执行摘要明确列出 CoreWeave、Nebius、Google Cloud、Oracle 的被评测样本角色；仅关联这些明确对象，不把排名视为官方认证。
- [事实] [中美成果共识](https://gq.china-embassy.gov.cn/zxxx/202609/t20260926_12031616.htm)第七项支持对话和事件沟通渠道的约定；未说明具体实施机关，不据此虚构牵头部门。9/26 为成果公开日，访问期间为 9/23–25。

## 证据层级

官方公告证明“该机构宣布了什么”，不证明未来计划必然兑现。论文证明作者提出了什么，不等于同行审查完成。监管提案、已公布法规、生效日期分开。无法读取正文、只有主页／动态榜单／搜索摘要的条目不得标记为完整核验。
