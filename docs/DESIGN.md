# HZense — 产品与系统设计文档

## HZense · Technology Intelligence

**版本：** v1.3  
**日期：** 2026-08-19  
**品牌：** HZense  
**品牌定位：** Technology Intelligence  
**品牌标语：** Sense what matters in technology.  
**官方域名：** `hzense.com`  
**Canonical URL：** `https://hzense.com`  
**文档类型：** 产品设计 / 信息架构 / 系统设计 / 实施规划

---

## 1. 项目定位

HZense 不是传统博客，也不是简单的收藏网站，而是一套面向长期技术研究、信息积累和趋势判断的个人技术情报平台。

核心链路：

> **Signals → Knowledge → Insights → Intelligence**

系统聚合并关联技术洞察、每日技术洞察简报、每周好文、科技信息解读、论文、公司与产品动态、人物与机构、技术资源、融资并购、政策变化和技术信号。

## 2. 核心能力

- **Discover** — 发现值得关注的信息与早期信号。
- **Organize** — 结构化 Topic、Technology、Company、People、Institution、Product、Paper、Event 和 Signal。
- **Connect** — 建立实体与知识之间的关系，形成 Technology Intelligence Graph。
- **Understand** — 沉淀自己的技术判断和趋势分析。
- **Track** — 持续跟踪热度、成熟度、竞争格局、研究方向、人才、投资和政策变化。

## 3. 信息生产链

```text
Sources
  ↓
Signals
  ↓
HZense Daily
  ↓
HZense Weekly
  ↓
HZense Topics
  ↓
HZense Insights
  ↓
HZense Radar
```

三层信息模型：Signals → Knowledge → Insights，最终形成 Intelligence。

## 4. 产品与一级导航

- **Home** — 技术情报驾驶舱
- **HZense Daily** — 每日技术洞察简报
- **HZense Insights** — 深度技术洞察
- **HZense Topics** — 专题知识库
- **HZense Radar** — 技术雷达
- **HZense Weekly** — 每周精选
- **HZense Resources** — 人物 / 公司 / 机构 / 论文 / 技术
- **HZense Signals** — 最新技术信号
- **Search / Ask HZense** — 全库搜索与 AI 技术情报问答

### 4.1 品牌与域名基线

HZense 的正式对外主域名为：

```text
hzense.com
```

生产环境统一使用：

```text
https://hzense.com
```

`hzense.com` 作为唯一 Canonical Domain。未来 `www.hzense.com` 应重定向至根域名，预览环境和临时部署地址不得作为搜索引擎 Canonical URL。

正式产品路径规划：

```text
https://hzense.com/             Home
https://hzense.com/daily        HZense Daily
https://hzense.com/weekly       HZense Weekly
https://hzense.com/signals      HZense Signals
https://hzense.com/insights     HZense Insights
https://hzense.com/topics       HZense Topics
https://hzense.com/radar        HZense Radar
https://hzense.com/resources    HZense Resources
https://hzense.com/ask          Ask HZense
```

当前状态：域名已经注册，网站部署和 DNS 绑定将在首个可用 MVP 发布时完成。

## 5. Home

首页定位为 Technology Intelligence Dashboard，突出 Today's Intelligence、Technology Radar、Latest Insights、Latest Signals、Weekly Picks 和 Trending Topics。

## 6. HZense Daily

Daily 是日常最高频情报入口，不是新闻摘要，而是当天 Signals 经过筛选、去重、关联和研判后形成的技术情报产品。

固定结构：今日必看 Top 5、AI & Compute、Cybersecurity、Semiconductors、Robotics & Physical AI、Research Watch、Company & Capital、Signals to Watch、My Intelligence Take、Related Topics。

历史按日期归档，正式发布后作为 Markdown 知识资产进入 Git。

## 7. HZense Insights

用于技术洞察、趋势分析、产业分析、技术路线、公司分析和专题报告。单篇结构包括 Summary、Key Takeaways、My View、Evidence、Related Signals / Companies / People / Technologies / Papers、Timeline 和 Sources。

## 8. HZense Topics

Topic 是核心组织单元。首批一级领域包括 Artificial Intelligence、Cybersecurity、Semiconductors、Robotics、Quantum、Cloud、Infrastructure、Autonomous Systems、Energy Technology、Space Technology、Biotechnology。

Topic 页面包含 Overview、My View、Attention、Trend、Maturity、Strategic Value、Key Problems、Key Players、Key People、Research、Signals、Insights 和 Timeline。

## 9. HZense Weekly

每周从 Daily + Signals 中提炼高价值内容和趋势。每篇精选保存 Source、Author、URL、Why Read、Key Points、My View、Importance 和实体关联。

## 10. Briefings

用于 5–10 分钟理解新技术、产品发布、公司事件和产业变化。

## 11. HZense Signals

Signal 是最小情报单元。类型包括 Research、Product、Funding、Acquisition、Hiring、Policy、Technology、Market、People、Open Source、Security、Patent。

## 12. HZense Resources

核心实体：Person、Company、Institution、Technology、Product、Model、Dataset、Standard / Protocol、Paper、Event。所有实体与 Topic、Signal、Insight 双向关联。

Paper 是客观论文实体；HZense 对论文的摘要、解读和判断以 PaperNote 内容独立保存。

## 13. HZense Radar

核心指标：Attention Score 0–100、Trend、Maturity、Strategic Value，并保存历史快照用于趋势变化分析。

## 14. Intelligence Graph

关系模型示例：Person → works_at → Company；Company → develops → Technology；Model → trained_on → Dataset；Model → evaluated_on → Dataset；Product → uses → Model；Technology → implements → Standard / Protocol；Paper → presented_at → Event；Signal → affects → Topic；Insight → supported_by → Signal。

## 15. Timeline

Topic、Company、Technology、Person、Product、Model 和 Event 支持时间线，并逐步从 Signals 自动生成。

## 16. Search / Ask HZense

全文搜索覆盖 Topic、Insight、Signal、Company、Person、Institution、Technology、Product、Model、Dataset、Standard / Protocol、Paper 和 Event。Ask HZense 后续基于 Hybrid Retrieval + RAG 回答，并提供来源引用。

## 17. 内容与数据原则

网站是 Presentation Layer，Knowledge Base 才是核心资产。正式正文使用 Markdown / MDX + YAML Front Matter；实体、关系、索引等结构化数据进入 PostgreSQL。

所有对象使用稳定唯一 ID，标题变化不能改变 ID。

## 18. 内容状态与重要度

状态：Draft / Review / Published / Archived。Topic 增加 Watching / Active / Strategic。重要度统一 1–5 星。

## 19. AI 辅助处理

AI 可辅助 URL 读取、摘要、Topic 分类、Company / People / Technology 实体识别、Signal Type、Importance 和关联推荐；My View 和核心战略判断保留人工确认。

## 20. 视觉设计

方向：SemiAnalysis × Bloomberg Terminal × Notion × Technology Research Institute，但降低 Bloomberg 的信息密度。PC 偏研究工作台，Mobile 偏 Daily、Signals、Weekly 和阅读。

## 21. 实施路线

### Phase 0A — 技术架构与品牌基线
- [x] HZense 品牌确定
- [x] `hzense.com` 官方域名注册
- [x] 产品信息架构
- [x] 首版技术架构设计

### Phase 0B — Schema / Taxonomy
- [x] Information Model
- [x] Taxonomy
- [x] Entity / Relation Schema
- [x] Machine-readable Schema
- [ ] Executable Front Matter Validation
- [ ] Physical Database Schema / Migrations
- [ ] Repository Skeleton

### Phase 1 — Knowledge Base
- [ ] Insights
- [ ] Daily
- [ ] Weekly
- [ ] Briefings
- [ ] Topics
- [ ] Signals
- [ ] Entities / Relations

### Phase 2 — Website MVP
- [ ] Home
- [ ] Daily
- [ ] Insights
- [ ] Topics
- [ ] Weekly
- [ ] Signals
- [ ] Resources
- [ ] Search
- [ ] Responsive UI
- [ ] Dark / Light Mode
- [ ] Vercel Deployment
- [ ] `hzense.com` DNS / Domain Binding

### Phase 3 — Radar
- [ ] Attention / Trend / Maturity / Strategic Value
- [ ] Historical snapshots

### Phase 4 — Timeline
- [ ] Entity timelines
- [ ] Signal-derived timeline

### Phase 5 — Intelligence Graph
- [ ] Entity Relation Model
- [ ] Graph Visualization

### Phase 6 — Ask HZense
- [ ] FTS
- [ ] Embeddings / pgvector
- [ ] Hybrid Search
- [ ] RAG
- [ ] Citations

### Phase 7 — Automated Ingestion
- [ ] RSS / arXiv / GitHub / Blogs / Company Sources / Newsletters
- [ ] Dedup / Classification / Entity Extraction / Ranking
- [ ] Signal Inbox + Human Review

### Phase 8 — Intelligence Automation
- [ ] Daily candidate generation
- [ ] Weekly candidate generation
- [ ] Topic updates
- [ ] Radar recommendations
- [ ] Emerging Topic Detection
- [ ] Weekly / Monthly Intelligence Reports

## 22. 推荐实施顺序

```text
Schema → Markdown Knowledge Base → Signals → HZense Daily → Website MVP
→ Search → Topics → HZense Weekly → Radar → Timeline → Intelligence Graph
→ Ask HZense / RAG → Automated Ingestion → Intelligence Automation
```

## 23. 最终目标

HZense 最终不是“保存写过什么”的静态网站，而是能够持续回答：一个技术方向发生了什么、谁最重要、哪些信号正在变成趋势、自己的判断如何变化、下一步值得关注什么。

> **HZense — Sense what matters in technology.**

---

## v1.3 域名基线更新

- 正式主域名锁定为 **hzense.com**。
- Canonical Production URL 锁定为 **https://hzense.com**。
- 产品公共路径统一规划为 `/daily`、`/weekly`、`/signals`、`/insights`、`/topics`、`/radar`、`/resources` 和 `/ask`。
- 首次 MVP 部署后绑定 Vercel，并将 `www.hzense.com` 重定向到根域名。
- 同步更新 Information Model v1.1 的十类 Entity 表述与项目实施状态。

## v1.2 品牌基线更新

- 正式品牌名锁定为 **HZense**。
- 品牌定位：**Technology Intelligence**。
- 品牌标语：**Sense what matters in technology.**
- 产品模块统一命名为 HZense Daily / Weekly / Signals / Insights / Topics / Radar / Resources / Ask HZense。
- 核心方法论保持：**Signals → Knowledge → Insights → Intelligence**。
