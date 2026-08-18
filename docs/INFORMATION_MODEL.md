# HZense — Information Model

## Technology Intelligence Information Model

**版本：** v1.0  
**日期：** 2026-08-18  
**状态：** Information Model Baseline  
**项目：** HZense — Technology Intelligence

---

# 1. 目标

HZense 的 Information Model 定义系统中的内容、实体、关系、信号、分类体系与技术雷达数据如何被统一组织。

它解决三个核心问题：

1. **内容如何结构化保存？**
2. **人物、公司、技术、论文、Topic 等对象如何关联？**
3. **Signals 如何逐步演化为 Daily、Weekly、Insights 与 Radar？**

HZense 的核心知识流：

> **Sources → Signals → Daily Intelligence → Weekly Intelligence → Topics → Insights → Radar**

其中：

- Git / Markdown 保存正式内容正文。
- PostgreSQL 保存 Entity / Relation / Index / Radar / Operational Data。
- Taxonomy 负责统一技术领域分类。
- Entity Graph 负责跨内容关联。

---

# 2. Information Model 分层

HZense 信息模型分为六层：

```text
Layer 1  Taxonomy
Layer 2  Entities
Layer 3  Relations
Layer 4  Signals
Layer 5  Content
Layer 6  Radar / Intelligence State
```

逻辑关系：

```text
Taxonomy
   ↓
Entities ←→ Relations
   ↑          ↑
Signals ──────┘
   ↓
Daily / Weekly / Insights
   ↓
Topics
   ↓
Radar
```

---

# 3. 全局对象规范

所有核心对象必须具有稳定 ID。

## 3.1 ID 规则

统一使用：

```text
<type>-<slug>
```

示例：

```text
topic-agent-security
company-nvidia
person-jensen-huang
institution-stanford-ai-lab
technology-mcp
product-chatgpt
paper-agent-security-2026-001
signal-20260818-001
insight-agent-security-001
daily-2026-08-18
weekly-2026-w34
```

要求：

- ID 一旦发布后不随标题变化。
- ID 全部小写。
- 使用 kebab-case。
- 禁止使用随机 UUID 作为对外内容 ID。
- 数据库内部可使用 UUID 作为 primary key，但必须保留稳定 public_id。

---

# 4. 通用 Metadata

所有正式内容统一支持以下通用字段：

```yaml
id: string
title: string
type: string
status: draft | review | published | archived
date: YYYY-MM-DD
updated_at: ISO-8601
language: zh-CN | en
importance: 1..5
summary: string
source_refs: []
topics: []
entities: []
tags: []
```

其中：

- `topics` 只允许引用正式 Taxonomy 中的 Topic ID。
- `entities` 只允许引用 Entity ID。
- `tags` 仅作为补充，不承担正式分类职责。

---

# 5. Content Model

HZense 正式内容类型包括：

```text
Daily
Weekly
Insight
Briefing
Topic
Paper Note
```

Signals 单独建模，不作为普通文章处理。

---

# 6. Daily Schema

Daily 是 HZense 的高频技术情报产品。

推荐路径：

```text
content/daily/YYYY/MM/DD.md
```

Front Matter：

```yaml
---
id: daily-2026-08-18
title: HZense Daily — 2026-08-18
type: daily
status: published
date: 2026-08-18
language: zh-CN
signal_count: 23
major_developments: 8
rising_topics:
  - topic-agent-security
  - topic-ai-infrastructure
importance: 5
---
```

正文固定结构：

```text
今日必看 Top 5
AI & Compute
Cybersecurity
Semiconductors
Robotics & Physical AI
Research Watch
Company & Capital
Signals to Watch
My Intelligence Take
Related Topics
```

Daily 必须可追溯到其引用的 Signals。

---

# 7. Weekly Schema

Weekly 用于从一周 Daily + Signals 中提炼周度趋势。

推荐路径：

```text
content/weekly/YYYY/Www.md
```

字段：

```yaml
---
id: weekly-2026-w34
title: HZense Weekly — 2026 W34
type: weekly
status: published
week: 2026-W34
start_date: 2026-08-17
end_date: 2026-08-23
signal_count: 146
daily_refs:
  - daily-2026-08-17
  - daily-2026-08-18
featured_topics:
  - topic-agent-security
importance: 5
---
```

正文建议：

```text
This Week in One Page
Top Developments
Trend Changes
Key Papers
Companies to Watch
Signals Becoming Trends
My Weekly View
Next Week Watchlist
```

---

# 8. Insight Schema

Insight 是 HZense 最高价值的深度内容。

推荐路径：

```text
content/insights/<id>.md
```

字段：

```yaml
---
id: insight-agent-security-001
title: Agent Security 正在成为新的安全边界
type: insight
status: published
date: 2026-08-18
importance: 5
topics:
  - topic-agent-security
companies:
  - company-microsoft
  - company-openai
technologies:
  - technology-mcp
evidence_signals:
  - signal-20260818-001
---
```

正文建议：

```text
Summary
Key Takeaways
My View
Evidence
Counter Signals
Implications
Related Companies
Related People
Related Papers
Timeline
Sources
```

Insight 必须支持 Evidence / Counter Evidence，以避免只保留单向观点。

---

# 9. Briefing Schema

Briefing 定位：

> **5–10 分钟理解一个重要事件、技术或变化。**

字段：

```yaml
---
id: briefing-mcp-security-001
title: MCP Security 是什么？
type: briefing
status: published
date: 2026-08-18
topics:
  - topic-agent-security
technologies:
  - technology-mcp
importance: 4
---
```

正文：

```text
What Happened
What It Is
Why It Matters
Key Players
Risks / Limitations
HZense View
Sources
```

---

# 10. Topic Schema

Topic 是整个 HZense 的核心聚合单元。

推荐路径：

```text
content/topics/<topic-id>.md
```

字段：

```yaml
---
id: topic-agent-security
title: Agent Security
type: topic
status: strategic
parent: topic-ai-security
attention: 88
trend: rapid_growth
maturity: early
strategic_value: high
---
```

Topic 状态：

```text
watching
active
strategic
archived
```

Topic 页面聚合：

- Overview
- My View
- Attention
- Trend
- Maturity
- Strategic Value
- Key Problems
- Key Technologies
- Key Companies
- Key People
- Research
- Signals
- Insights
- Timeline

---

# 11. Paper Note Schema

Paper Note 用于保存重要论文的结构化研究笔记。

字段：

```yaml
---
id: paper-agent-security-2026-001
title: Example Paper Title
type: paper
status: published
date: 2026-08-18
paper_url: https://example.org
conference: ExampleConf
authors:
  - person-example-researcher
institutions:
  - institution-example-lab
topics:
  - topic-agent-security
importance: 4
---
```

正文：

```text
Abstract Summary
Problem
Method
Key Findings
Limitations
Why It Matters
My Notes
Related Work
```

---

# 12. Entity Model

HZense V1 定义六类一级实体：

```text
Person
Company
Institution
Technology
Product
Paper
```

Topic 不归入 Entity，而属于 Taxonomy + Knowledge Aggregation Layer。

---

# 13. Person Entity

字段：

```yaml
id: person-jensen-huang
type: person
name: Jensen Huang
aliases: []
role: CEO
organizations:
  - company-nvidia
location: US
research_areas: []
topics: []
website: null
status: active
```

可关联：

- Company
- Institution
- Paper
- Technology
- Topic
- Signal
- Insight

---

# 14. Company Entity

字段：

```yaml
id: company-nvidia
type: company
name: NVIDIA
aliases: []
country: US
founded: 1993
website: https://www.nvidia.com
categories: []
technologies: []
products: []
status: active
```

可扩展字段：

- founders
- funding
- investors
- competitors
- market_status
- headquarters

---

# 15. Institution Entity

用于：

- University
- Lab
- Research Center
- Government Agency
- Standards Organization

字段：

```yaml
id: institution-stanford-ai-lab
type: institution
name: Stanford AI Lab
institution_type: lab
country: US
city: Stanford
website: null
topics: []
status: active
```

---

# 16. Technology Entity

Technology 是具体技术对象，而 Topic 是研究分类与聚合入口。

例如：

```text
Topic: Agent Security
Technology: MCP
Technology: OAuth
Technology: Sandboxing
```

字段：

```yaml
id: technology-mcp
type: technology
name: Model Context Protocol
aliases:
  - MCP
category: protocol
status: emerging
topics:
  - topic-ai-agents
  - topic-agent-security
```

---

# 17. Product Entity

字段：

```yaml
id: product-chatgpt
type: product
name: ChatGPT
company: company-openai
product_type: ai_application
status: active
technologies: []
topics: []
```

---

# 18. Relation Model

统一 Relation Schema：

```yaml
id: relation-xxxx
source: entity-id
relation_type: works_at
target: entity-id
valid_from: null
valid_to: null
confidence: 1.0
source_refs: []
metadata: {}
```

关系必须有方向。

---

# 19. Relation Types v1

## Person → Organization

```text
works_at
founded
leads
advises
invests_in
```

## Company → Company

```text
acquired
invested_in
partnered_with
competes_with
supplies
customer_of
```

## Company → Product / Technology

```text
develops
owns
uses
integrates
commercializes
```

## Institution → Person / Technology

```text
employs
researches
created
collaborates_with
```

## Paper → Entity / Topic

```text
authored_by
published_by
researches
supports
challenges
```

## Generic

```text
related_to
mentions
influences
depends_on
part_of
```

所有 relation_type 必须来自受控枚举，禁止随意新建字符串。

---

# 20. Signal Model

Signal 是 HZense 最小情报单元。

Signal 不等于新闻，也不等于文章。

Signal 表示：

> **一个可能影响技术判断、Topic 状态或未来趋势的可追踪变化。**

---

# 21. Signal Schema

```yaml
id: signal-20260818-001
title: Example Signal
type: product
occurred_at: 2026-08-18T10:00:00Z
captured_at: 2026-08-18T10:15:00Z
status: reviewed
source_type: web
source_url: https://example.com
source_name: Example
summary: string
importance: 4
strength: 3
confidence: 0.9
novelty: 0.8
entities:
  - company-example
topics:
  - topic-example
technologies: []
geo: []
language: en
promoted_to_daily: false
promoted_to_weekly: false
```

---

# 22. Signal Type v1

```text
research
product
funding
acquisition
hiring
policy
technology
market
people
open_source
security
patent
partnership
regulation
supply_chain
```

---

# 23. Signal 评分模型

V1 不做复杂 ML 评分，采用透明指标。

## Importance

```text
1 = ordinary reference
2 = useful
3 = worth tracking
4 = important
5 = strategic
```

## Strength

表示该 Signal 对趋势的证明力度：

```text
1 = weak
2 = moderate
3 = meaningful
4 = strong
5 = decisive
```

## Confidence

```text
0.0 – 1.0
```

表示来源和事实可信度。

## Novelty

```text
0.0 – 1.0
```

表示相对于已有知识库的新颖程度。

---

# 24. Signal 生命周期

```text
captured
   ↓
normalized
   ↓
classified
   ↓
reviewed
   ↓
accepted / rejected
   ↓
promoted
```

Signal Status：

```text
inbox
reviewed
accepted
rejected
archived
```

自动采集只允许进入 `inbox`。

只有 reviewed / accepted 的 Signal 才能影响 Daily / Radar。

---

# 25. Source Model

每条 Signal 必须关联 Source。

Source 类型：

```text
website
rss
paper
company_blog
research_lab
news_media
newsletter
github
social
regulator
patent_database
```

Source 字段：

```yaml
id: source-openai-blog
name: OpenAI Blog
type: company_blog
url: https://example.com
trust_score: 0.95
active: true
```

---

# 26. Taxonomy Model

Taxonomy 是 HZense 的正式分类体系。

原则：

1. Topic 使用稳定 ID。
2. 支持父子层级。
3. 每个 Topic 最多一个 primary parent。
4. 跨领域关系使用 Relation，不使用多父节点制造混乱。
5. 自由 Tag 不能替代正式 Topic。

---

# 27. 一级 Taxonomy v1

首版一级领域：

```text
Artificial Intelligence
Cybersecurity
Semiconductors
Robotics
Quantum
Cloud & Infrastructure
Autonomous Systems
Energy Technology
Space Technology
Biotechnology
```

其中 HZense 初期重点领域建议优先完善：

```text
Artificial Intelligence
Cybersecurity
Semiconductors
Robotics
```

---

# 28. Artificial Intelligence Taxonomy

```text
Artificial Intelligence
├── Foundation Models
│   ├── Language Models
│   ├── Multimodal Models
│   ├── Reasoning Models
│   └── Small Models
├── AI Agents
│   ├── Agent Architecture
│   ├── Tool Use
│   ├── Memory
│   ├── Multi-Agent Systems
│   └── Agent Protocols
├── AI Security
│   ├── Model Security
│   ├── Agent Security
│   ├── Prompt Injection
│   ├── AI Supply Chain Security
│   └── AI Runtime Security
├── AI Infrastructure
│   ├── Training Infrastructure
│   ├── Inference Infrastructure
│   ├── AI Networking
│   └── AI Data Infrastructure
├── AI Safety
└── Physical AI
```

---

# 29. Cybersecurity Taxonomy

```text
Cybersecurity
├── Cloud Security
├── Endpoint Security
├── Identity & Access
├── Application Security
├── Network Security
├── Data Security
├── Zero Trust
├── Software Supply Chain Security
├── Hardware Security
└── AI Security
```

`AI Security` 作为跨域 Topic，primary parent 设在 Artificial Intelligence；Cybersecurity 侧通过 `related_to` 建立关联。

---

# 30. Semiconductors Taxonomy

```text
Semiconductors
├── GPU
├── CPU
├── AI Accelerators
├── Memory
│   ├── HBM
│   └── DRAM
├── Advanced Packaging
├── Lithography
├── Foundry
├── EDA
├── Chiplets
└── Semiconductor Supply Chain
```

---

# 31. Robotics Taxonomy

```text
Robotics
├── Humanoid Robotics
├── Industrial Robotics
├── Service Robotics
├── Robot Learning
├── Embodied AI
├── Autonomous Navigation
└── Robot Hardware
```

---

# 32. Radar Model

Radar 用于表示一个 Topic 当前的技术情报状态。

Radar Snapshot 必须是时间序列数据，不能只保存当前值。

---

# 33. Radar Snapshot Schema

```yaml
id: radar-topic-agent-security-2026-08-18
topic: topic-agent-security
date: 2026-08-18
attention: 88
trend: rapid_growth
maturity: early
strategic_value: high
confidence: 0.87
signal_count_7d: 16
signal_count_30d: 48
insight_refs: []
reasoning: string
```

---

# 34. Radar 指标

## Attention

```text
0–100
```

表示当前值得关注程度。

## Trend

```text
rapid_growth
growth
stable
decline
rapid_decline
```

## Maturity

```text
research
early
emerging
growth
mature
```

## Strategic Value

```text
low
medium
high
critical
```

## Confidence

```text
0.0 – 1.0
```

表示 Radar 判断本身可信度。

---

# 35. Radar V1 计算原则

首版不使用完全自动黑盒算法。

Radar 值由以下输入共同决定：

```text
Signals
Daily
Weekly
Insights
Research Activity
Company Activity
Capital Activity
```

AI 可以推荐分数，但最终支持人工确认。

每次分数变化都必须保留历史 Snapshot。

---

# 36. 内容到 Entity 的关联规则

所有正式内容可以引用：

```text
Topic IDs
Entity IDs
Signal IDs
Content IDs
```

禁止直接使用名称作为唯一关联键。

错误：

```yaml
companies:
  - NVIDIA
```

正确：

```yaml
companies:
  - company-nvidia
```

展示层负责把 ID 解析成人类可读名称。

---

# 37. Evidence Model

HZense 的 Insight 和 Radar 判断需要可追溯证据。

建议 Evidence 统一引用：

```text
Signal
Paper
Daily
Weekly
Source
```

未来可增加：

```yaml
evidence:
  - ref: signal-20260818-001
    stance: supports
    weight: 0.8
  - ref: paper-agent-security-2026-001
    stance: challenges
    weight: 0.6
```

这样可以支持：

- supporting evidence
- counter evidence
- confidence calculation

---

# 38. Timeline Model

Timeline 不单独重复存储事件正文。

Timeline 由以下对象聚合生成：

```text
Signals
Product Events
Company Events
Paper Dates
Insight Dates
Relation Changes
```

Timeline Event Schema：

```yaml
id: timeline-event-xxxx
date: 2026-08-18
entity: company-example
event_type: product_launch
ref: signal-20260818-001
importance: 4
```

---

# 39. Search Document Model

搜索索引统一生成 Search Document：

```yaml
id: searchdoc-xxxx
source_id: insight-agent-security-001
source_type: insight
title: string
body: string
topics: []
entities: []
importance: 5
date: 2026-08-18
embedding_ref: null
```

Search Document 是派生数据，不是 Source of Truth。

可以随时重新生成。

---

# 40. 数据库核心表建议

V1 PostgreSQL 预计包含：

```text
entities
entity_aliases
relations
topics
topic_relations
signals
signal_sources
sources
radar_snapshots
content_index
search_documents
embeddings
ingestion_jobs
```

正文内容继续保存在 Markdown。

---

# 41. 数据一致性规则

必须满足：

1. 所有 ID 唯一。
2. 所有关系 source / target 必须存在。
3. 所有 Topic 引用必须存在于 Taxonomy。
4. archived 对象不得自动进入新 Daily。
5. rejected Signal 不得影响 Radar。
6. 删除 Entity 优先采用 archived，不做物理删除。
7. Search / Embedding 属于可重建派生数据。
8. Markdown 正文与 PostgreSQL index 通过 public_id 对齐。

---

# 42. Versioning

Information Model 使用语义版本：

```text
v1.0
v1.1
v2.0
```

规则：

- 增加可选字段：minor
- 增加枚举值：minor
- 修改 ID 规则：major
- 删除字段：major
- 改变 Source of Truth：major

每个内容文件可保存：

```yaml
schema_version: 1.0
```

---

# 43. V1 实施边界

V1 实施：

- Content schemas
- Topic taxonomy
- Entity schemas
- Relation types
- Signal model
- Source model
- Radar model
- Search document model

V1 暂不实施：

- ontology reasoning
- graph centrality
- multi-parent ontology
- automatic causal inference
- complex probabilistic scoring

保持模型可理解、可维护、可扩展。

---

# 44. 推荐目录

```text
content/
├── daily/
├── weekly/
├── insights/
├── briefings/
├── topics/
└── papers/

data/
├── taxonomy/
│   └── taxonomy.yaml
└── schema/
    └── information-model.yaml

docs/
├── DESIGN.md
├── TECHNICAL_ARCHITECTURE.md
└── INFORMATION_MODEL.md
```

---

# 45. Information Model 完成标准

当以下条件满足，HZense 可以正式进入 Repository Skeleton + MVP 开发：

- [x] Content types 已定义
- [x] Taxonomy 模型已定义
- [x] 一级 / 二级核心 Taxonomy 已建立
- [x] Entity types 已定义
- [x] Relation types 已定义
- [x] Signal schema 已定义
- [x] Signal lifecycle 已定义
- [x] Source schema 已定义
- [x] Radar schema 已定义
- [x] Search document model 已定义
- [x] ID / Versioning / Data consistency 已定义

---

# 46. 架构结论

HZense 的信息模型以三个原则为核心：

> **Structured enough for machines.**  
> **Readable enough for humans.**  
> **Stable enough for long-term knowledge accumulation.**

最终形成：

```text
Sources
  ↓
Signals
  ↓
Knowledge
  ↓
Entities + Relations
  ↓
Daily / Weekly
  ↓
Topics
  ↓
Insights
  ↓
Radar
  ↓
Intelligence
```

这套模型作为 HZense v1.0 的正式 Information Model Baseline。
