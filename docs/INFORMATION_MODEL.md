# HZense — Information Model

## Technology Intelligence Information Model

**版本：** v2.0.0

**日期：** 2026-08-30

**状态：** Evidence Integrity Baseline — Topic Authority Contract Hardened

**项目：** HZense — Technology Intelligence

本次修订将既有的 Taxonomy 权威规则固化为 Taxonomy → Seed → Content 可执行门禁，并定义其完整 PostgreSQL 派生投影；Source of Truth 未改变，因此保持 v2.0.0。

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
edition: live
date: 2026-08-18
language: zh-CN
timezone: Europe/Berlin
window_start_at: 2026-08-17T07:00:00+02:00
cutoff_at: 2026-08-18T07:00:00+02:00
generator_version: daily-v1
input_fingerprint: sha256:...
summary: 本期经人工审核的科技情报摘要。
signal_count: 5
major_developments: 5
rising_topics:
  - topic-agent-security
  - topic-ai-infrastructure
signal_refs:
  - signal-example-1
  - signal-example-2
  - signal-example-3
  - signal-example-4
  - signal-example-5
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

Continuous Daily 自动化只能生成 `status: draft`。`live` 版本必须保留选择窗口、cutoff、生成器版本与输入指纹；人工核验并移除候选占位内容后才能改为 `published`。回顾样例使用 `edition: historical_example`，避免把后来回填的 Signal 冒充为历史日期当时已经采集的证据。

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
source_id: source-openai-blog
source_url: https://openai.com/example-event
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
url: https://openai.com/
trust_score: 95
active: true
allowed_hosts:
  - openai.com
```

`allowed_hosts` 表示发布者自身域名或其授权分发商域名。Signal 的 `source_url` hostname 必须命中该白名单；发布者身份与页面托管方不同的情况（例如公司签发、新闻稿平台分发）需要显式列出，不能只凭展示名称推断。

---

# 26. Taxonomy Model

Taxonomy 是 HZense 的正式分类体系。

原则：

1. Topic 使用稳定 ID。
2. 支持父子层级。
3. 每个 Topic 最多一个 primary parent。
4. 跨领域关系使用 Relation，不使用多父节点制造混乱。
5. 自由 Tag 不能替代正式 Topic。

权威边界：

- [`data/taxonomy/taxonomy.yaml`](../data/taxonomy/taxonomy.yaml) 是 Topic ID、英文规范名、primary parent 和跨域关系的唯一权威。
- [`data/seed/topics.yaml`](../data/seed/topics.yaml) 只能选择 Taxonomy 中的运行时子集并补充 `status`；其 ID 与英文标题不得覆盖 Taxonomy。
- `content/topics/` 下的 Markdown / MDX 只保存已启用 Topic 的本地化页面、展示字段与正文；目录可递归组织，每个非 archived Seed Topic 必须恰有一个页面，状态必须与 Seed 一致，显式 `parent` 必须与 Taxonomy 一致。
- PostgreSQL `topics` 是完整 Taxonomy 的派生投影，不反向拥有或修改 Taxonomy；首次生产同步已于 2026-08-31 完成并独立验证。

---

# 27. 一级 Taxonomy v1

以下各级树是正式 YAML 的说明性快照；发生差异时始终以 `data/taxonomy/taxonomy.yaml` 为准。

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
└── Hardware Security

AI Security → related_to → Cybersecurity (primary parent: Artificial Intelligence)
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
domain: security
attention: 88
trend: rapid_growth
maturity: early
strategic_value: high
confidence: 0.87
evidence_signals:
  - signal-20260818-001
reasoning: 人工确认的评分依据、证据局限与判断说明。
```

`evidence_signals` 是有序、非空的评分级证据，不等同于按 Topic 自动聚合的相关内容。每条证据必须存在、不得重复、状态为 `reviewed` 或 `accepted`、关联同一 Topic，且 `occurred_at` 与 `captured_at` 均不得晚于快照日期。Signal 的 `source_url` 必须指向该事件的精确 HTTPS 原始页面。

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

V2 的 Radar 以 `evidence_signals` 明确保存评分级 Signal 引用，并由 `reasoning` 记录人工判断。Signal 的 `source_url` 指向精确原始页面，从 Radar 到 Signal 再到一手来源形成可点击链路。按 Topic 自动聚合的内容只能标记为“相关内容”，不能替代评分证据。

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

# 40. PostgreSQL 物理数据库设计

## 40.1 范围与权威来源

本节描述当前已经实现并由自动校验保护的 PostgreSQL `public` Schema 基线，不把未来规划表述为现状。当前基线包含：

- 13 张持久表：12 张领域或派生数据表，以及 1 张 Migration 历史表。
- 9 个 PostgreSQL Enum。
- `vector` 扩展，以及 `search_documents.embedding vector(1536)`。
- 仓库 Migration manifest 登记三个顺序文件：`0000_foundation.sql`、`0001_radar_evidence.sql` 与 `0002_topic_projection.sql`；2026-08-31 的独立生产复核确认三者均已执行且 0 pending。

物理结构的权威顺序如下：

1. [`db/migrations/*.sql`](../db/migrations/) 是 12 张应用 Schema 表的可执行 DDL 权威来源。
2. [`packages/database/src/migrate.mjs`](../packages/database/src/migrate.mjs) 创建并维护第 13 张运维表 `hzense_schema_migrations`。
3. [`packages/database/src/schema.ts`](../packages/database/src/schema.ts) 是 12 张应用 Schema 表的 Drizzle 类型映射；运维历史表不进入应用 ORM 映射。
4. [`packages/database/src/verify.mjs`](../packages/database/src/verify.mjs) 独立校验完整 13 表的列、类型、主外键、检查约束、默认值、索引、Enum、pgvector 和 Migration 历史。
5. 本节是上述可执行合约的设计说明，不能代替 Migration 或 Runner DDL。

Git / Markdown 仍是 Daily、Weekly、Insight、Briefing、Topic 和 PaperNote 正文的 Source of Truth。PostgreSQL 保存结构化 Entity、Relation、Signal、Radar、内容登记和可重建搜索数据，不保存正式正文。

## 40.2 已实现表清单

| 领域               | 表                         | 职责与关键字段                                                                                      | 主键、唯一约束与核心关系                                                                          |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Taxonomy           | `topics`                   | Topic 标识、标题、可选 `parent_id`、状态、`runtime_enabled` 和 JSONB 元数据                         | PK `id`；`parent_id` 当前不是自引用外键                                                           |
| Entity Graph       | `entities`                 | Person、Company、Technology、Model 等实体；别名以内联 `text[]` 保存                                 | PK `id`                                                                                           |
| Source             | `sources`                  | 来源类型、主页、可信度、启用状态和允许的证据域名                                                    | PK `id`                                                                                           |
| Signal             | `signals`                  | 事件时间、来源、精确证据 URL、摘要、重要度、强度、置信度、新颖度和状态                              | PK `id`；`source_id` FK → `sources.id`                                                            |
| Entity / Topic     | `entity_topics`            | Entity 与 Topic 的多对多关联                                                                        | 复合 PK `(entity_id, topic_id)`；两端均为 FK，删除父对象时级联删除关联                            |
| Signal / Topic     | `signal_topics`            | Signal 与 Topic 的多对多关联                                                                        | 复合 PK `(signal_id, topic_id)`；两端均为 FK，删除父对象时级联删除关联                            |
| Signal / Entity    | `signal_entities`          | Signal 与 Entity 的多对多关联                                                                       | 复合 PK `(signal_id, entity_id)`；两端均为 FK，删除父对象时级联删除关联                           |
| Entity Graph       | `relations`                | Entity → Entity 有向关系，包含关系类型、有效期、置信度、来源引用和 JSONB 元数据                     | PK `id`；`source_id` 与 `target_id` 均 FK → `entities.id`                                         |
| Radar              | `radar_snapshots`          | Topic 在指定日期的 Domain、Attention、Trend、Maturity、Strategic Value、Confidence 和人工 Reasoning | PK `id`；`topic_id` FK → `topics.id`；唯一 `(topic_id, snapshot_date)`                            |
| Radar Evidence     | `radar_snapshot_signals`   | Radar Snapshot 的有序评分证据                                                                       | 复合 PK `(snapshot_id, signal_id)`；唯一 `(snapshot_id, position)`；Snapshot 删除时级联删除证据边 |
| Content Metadata   | `content_registry`         | Markdown 内容的类型、仓库路径、发布状态和时间                                                       | PK `id`；`path` 唯一                                                                              |
| Search / Embedding | `search_documents`         | 可重建搜索文档，包含正文副本、Topic / Entity JSONB 投影和可选 `vector(1536)`                        | PK `id`；`source_id` 是跨内容类型的逻辑引用，当前没有数据库外键                                   |
| Operations         | `hzense_schema_migrations` | 已执行 Migration 的文件名、64 字符 SHA-256 Checksum 和应用时间                                      | PK `name`                                                                                         |

## 40.3 核心关系

```text
sources 1 ─────── N signals

entities N ───── N topics
          entity_topics

signals  N ───── N topics
          signal_topics

signals  N ───── N entities
          signal_entities

entities 1 ───── N relations N ───── 1 entities
          source_id                 target_id

topics 1 ─────── N radar_snapshots
radar_snapshots N ───── N signals
                  radar_snapshot_signals（有序证据）
```

所有当前公开对象都直接使用稳定 `text` ID 作为主键；尚未采用“内部 UUID + `public_id`”双层键设计。

## 40.4 声明式约束与索引

数据库直接保证以下规则：

- `sources.trust_score` 为 `0..100`，`allowed_hosts` 必须为非空数组。
- `signals.source_url` 必须以 `https://` 开头；`importance` 与 `strength` 为 `1..5`；`confidence` 与 `novelty` 为 `0..1`。
- `relations.confidence` 为 `0..1`。
- `radar_snapshots.attention` 为 `0..100`，`confidence` 为 `0..1`，`reasoning` 去除空白后不得为空。
- `radar_snapshot_signals.position` 必须非负，并且同一 Snapshot 内不得重复。
- `topics.runtime_enabled` 为非空布尔值，由同步器按 Seed 成员身份与非 archived 状态确定。
- `hzense_schema_migrations.checksum` 长度必须为 64。

显式查询索引覆盖：

- `entities(type)` 与 `entities(name)`。
- `signals(occurred_at)` 与 `signals(status)`。
- `relations(source_id)` 与 `relations(target_id)`。
- `radar_snapshot_signals(signal_id)`。
- `search_documents(source_id)`。

当前物理基线没有 RLS、Policy 或用户 Trigger。未来引入这些机制必须通过单独评审的新 Migration，并同步更新 Verifier 和本节；仅当变更可由 Drizzle 表达且影响应用类型映射时，才同步更新 Drizzle Schema。

## 40.5 Enum 与 pgvector

| Enum              | 允许值                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity_type`     | `person`、`company`、`institution`、`technology`、`product`、`model`、`dataset`、`standard_protocol`、`paper`、`event`                                                                  |
| `signal_type`     | `research`、`product`、`funding`、`acquisition`、`hiring`、`policy`、`technology`、`market`、`people`、`open_source`、`security`、`patent`、`partnership`、`regulation`、`supply_chain` |
| `signal_status`   | `inbox`、`reviewed`、`accepted`、`rejected`、`archived`                                                                                                                                 |
| `source_type`     | `website`、`rss`、`paper`、`company_blog`、`research_lab`、`news_media`、`newsletter`、`github`、`social`、`regulator`、`patent_database`                                               |
| `topic_status`    | `watching`、`active`、`strategic`、`archived`                                                                                                                                           |
| `trend`           | `rapid_growth`、`growth`、`stable`、`decline`、`rapid_decline`                                                                                                                          |
| `maturity`        | `research`、`early`、`emerging`、`growth`、`mature`                                                                                                                                     |
| `strategic_value` | `low`、`medium`、`high`、`critical`                                                                                                                                                     |
| `radar_domain`    | `artificial_intelligence`、`infrastructure`、`security`、`robotics`                                                                                                                     |

`search_documents.embedding` 是可空的 `vector(1536)`。Embedding 与 Search Document 同生命周期保存，当前没有独立 `embeddings` 表。

## 40.6 实现边界与原规划差异

| 逻辑概念或原规划     | 当前物理实现或边界                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity_aliases`     | 未独立建表；别名保存在 `entities.aliases text[]`。                                                                                                                      |
| `topic_relations`    | 尚未实现；当前 `relations` 只连接 Entity。                                                                                                                              |
| `signal_sources`     | 尚未实现多来源表；每条 Signal 当前只有一个 `source_id`，并以 `source_url` 保存精确证据页面。                                                                            |
| `content_index`      | 实际实现为 `content_registry`，只登记 Markdown 内容元数据，不保存正式正文。                                                                                             |
| `embeddings`         | 未独立建表；向量内联在 `search_documents.embedding`。                                                                                                                   |
| `ingestion_jobs`     | 尚未实现。                                                                                                                                                              |
| Topic 层级           | `topics.parent_id` 是 Taxonomy primary parent 的数据库投影；父级存在性、唯一性与循环由 Taxonomy 门禁保证，同步不得生成不同层级。                                        |
| Topic 运行时启用     | `topics.runtime_enabled` 仅当 Topic 存在于 Seed 且 Seed 状态不是 `archived` 时为 `true`；Taxonomy-only Topic 为 `false`。                                               |
| Topic 跨域关系       | 本阶段仍只存在于正式 Taxonomy YAML；物理数据库尚无 `topic_relations` 表，同步器不把关系塞入 Entity `relations` 或 Topic `metadata`。                                    |
| Search Document 来源 | `search_documents.source_id` 可以引用不同内容类型，因此当前不绑定单一数据库外键；该表是可重建派生数据。                                                                 |
| Radar 证据资格       | 数据库保证外键、唯一性和位置范围；其余跨表资格规则由 Migration 审计和生产 Verifier 检测。未来运行时写入路径必须额外提供事务化保证，当前数据库本身不会持续阻止此类违规。 |
| 正文存储             | Daily、Weekly、Insight、Briefing、Topic 和 PaperNote 正文继续保存在 Git / Markdown。                                                                                    |
| Migration 历史       | `hzense_schema_migrations` 是运维控制表，不属于领域信息模型。                                                                                                           |

物理表已经存在不代表 Web Runtime 已经接入数据库；运行时连接、权限和发布状态以 [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) 为准。

## 40.7 Topic 派生投影同步合约

PostgreSQL `topics` 投影完整 Taxonomy，而不是只投影 Seed 子集。列所有权固定如下：

- `id`、`title`、`parent_id` 分别来自 Taxonomy 的 `id`、英文规范名和 primary parent。
- Topic 存在于 Seed 时，`status` 使用 Seed 状态；Taxonomy-only Topic 回退为 `watching`。
- `runtime_enabled = true` 当且仅当 Topic 存在于 Seed 且状态不是 `archived`。
- Topic Markdown / MDX 必须先通过页面覆盖、状态和显式 parent 完整门禁，但本地化标题、展示字段与正文不进入 PostgreSQL。
- `cross_domain_relations` 本阶段仍只保存在 Taxonomy YAML；同步器不创建隐式数据库关系。

同步器一次运行只接受同一 Git 工作树生成的确定性输入，并区分两类 SHA-256：source fingerprint 只绑定权威投影；plan fingerprint 同时绑定 source fingerprint、当前数据库托管字段，以及 insert / update / no-op 行集。它遵守以下写入边界：

1. 默认运行不持久化的 dry run：在事务内计算并输出 source 与 plan fingerprint，执行拟议 DML 与写后校验，随后强制回滚。
2. Apply 在一个事务中完成，并复用 Migration advisory lock；取得 advisory lock 与 `topics` table lock 后，必须在任何写入前重新计算并精确匹配 source 与 plan fingerprint，避免输入或 dry run 后的 Topic 托管字段与计划漂移。物理 Schema 完整性由同一维护窗口内先行执行的 `db:verify:production` 保证。
3. 只允许 `INSERT` 与权威列 `UPDATE`，绝不 `DELETE`、`TRUNCATE` 或修改 Schema。
4. 如果数据库存在 Taxonomy 之外的 Topic ID，立即 fail closed，不自动删除、归档或接管未知数据。
5. 生产 Apply 必须通过 `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT` 提供完全匹配的 source fingerprint，通过 `HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT` 提供完全匹配的 plan fingerprint，并通过 `HZENSE_TOPIC_SYNC_BACKUP_ID` 提供操作者已验证本次新备份后的 backup ID 声明；执行角色固定为独立最小权限 `hzense_topic_sync`。
6. CLI 只校验 backup ID 声明的存在性与格式，不调用 provider，也不证明备份存在或可恢复；provider 侧的创建、列出与恢复验证必须由操作者在 Apply 前独立完成。
7. 生产预检必须拒绝 `hzense_topic_sync` 访问 `public` 之外任何非系统 Schema，或执行任何非系统 Schema 中的 `SECURITY DEFINER` routine；有效 relation/table 权限、列级权限、Sequence 权限与 Schema 对象 ownership 检查覆盖所有非系统 Schema。
8. Apply 后必须独立验证完整行集和列值，再次运行必须生成 no-op 计划，才能证明幂等。

仓库实现与本地测试本身不代表生产已同步；本次另有现场证据。2026-08-31 已在新可恢复分支备份保护下完成 `hzense_topic_sync` 最小权限配置、生产 dry run、reviewed source / plan fingerprint 防护的 Apply、独立只读验证与 no-op 重跑。结果为 62 个 Topics、0 个未知行、reviewed fingerprint 匹配及 no-op 0 变更。实际 backup ID、连接目标、凭据和 fingerprint 值只保存在受保护运维记录中，不进入仓库。

`runtime_enabled` 由 `0002_topic_projection.sql` 引入。该 Migration 先以 `false` 创建非空列，再将已有 `active` / `strategic` 行回填为 `true`，最后增加“archived 不得启用”的检查约束；完整 Taxonomy 同步随后用权威投影覆盖最终状态。生产 `0002` 与首次完整投影均已在 2026-08-31 执行和独立验证。

## 40.8 Schema 演进规则

- 已应用 Migration 只追加、不修改；文件 Checksum 固定在 [`db/migrations/checksums.json`](../db/migrations/checksums.json)。
- 新表、列、Enum 值、约束、索引或权限策略必须通过新的顺序 Migration 引入。
- Migration Runner 使用 PostgreSQL Advisory Lock 串行化执行；每个 Migration 的 DDL 与对应历史记录在同一事务中原子提交。
- 每次结构变更必须同步更新本节和独立 Verifier；可由 Drizzle 表达且影响应用类型映射的变更，还必须同步更新 Drizzle Schema。
- 未来规划对象必须明确标记为“未实现”，不能与当前物理表共同表述为现状。

## 40.9 Runtime Reader 边界

Runtime Reader 只消费 Topic 派生投影，不成为新的 Topic Source of Truth。它与 Migrator、`hzense_topic_sync` 分属三个互不复用的角色；固定登录角色为 `hzense_runtime`。

| 审计范围      | 允许的 HZense 应用运行时能力                            |
| ------------- | ------------------------------------------------------- |
| Database      | 目标数据库 `CONNECT`                                    |
| Schema / enum | `public` Schema `USAGE`；`topic_status` enum `USAGE`    |
| Relation      | 仅 `topics` 的 column-level `SELECT`                    |
| Columns       | `id`、`title`、`parent_id`、`status`、`runtime_enabled` |

`metadata`、Migration history、其他 HZense 表和其他列均不可读；应用 relation 写入、DDL、`TEMPORARY`、Sequence、应用 routine、数据库 / Migration owner 的未来对象 `PUBLIC` 默认权限、任何 principal 直接给 Runtime 的未来对象默认授权、应用对象 ownership 与 grant option 均不可用，其他应用 enum types 的 `USAGE` 也被撤销。其他可创建应用对象的 principal 仍需纳入外部 DDL 治理与冻结；preflight 拒绝最终产生的 Runtime 有效访问，但不重写每个 principal 的 `PUBLIC` defaults。只有经 extension dependency 证明的 `SECURITY INVOKER` pgvector functions 可以保留既有 `PUBLIC EXECUTE`：普通合约要求 routine owner 等于 extension owner，且该 owner 不是 Runtime 或数据库 owner；Neon Production 的窄合约精确固定 `vector 0.8.6`、routine owner `cloud_admin`、extension owner `neondb_owner`，并仅由已完成 Neon pooler/TLS 门禁的 runner 启用。现场 118 个 routines 全部位于 `public` Schema 且匹配，无 `SECURITY DEFINER`、grant option 或 Runtime direct ACL。routine 审计覆盖所有非系统 Schema，不依赖 Schema `USAGE`；任何版本、owner、dependency、security mode 或 ACL 漂移，任何非 pgvector 应用 routine、非系统 table-inheritance 边或可绕过应用表 ACL 的执行路径都会使部署前 preflight 失败。首个查询使用 `FROM ONLY public.topics`，避免继承子表参与父表扫描。

Type denylist 只覆盖非系统应用 enums；provider-owned extension Types 与其他非-enum Types 不在该声明内，当前实现不声称移除了它们的 ambient PostgreSQL `USAGE`。它们不扩展固定五列投影。

`hzense_runtime` 还必须对同一 cluster 中每个普通非目标且 `datallowconn = true` 的数据库均无有效 `CONNECT`、`CREATE` 或 `TEMPORARY`。该 cluster-wide 前置由 provider / 集群管理员实施；目标数据库 owner 脚本与 restricted preflight 只枚举并 fail closed，不修改其他数据库。以后新增可连接数据库会再次触发 drift 门禁。

Neon 的 provider-owned `postgres` 与 `template1` 是唯一保留库例外，而且例外绑定完整合约而非名称：owner 固定为 `cloud_admin`，数据库模板标志、connection limit、default-vs-explicit ACL 形态、PUBLIC 能力、grant option 与 Runtime direct ACL 必须精确匹配；两者都无 `CREATE`，`postgres` 只保留 provider 默认的 `PUBLIC CONNECT` / `TEMPORARY`，`template1` 只保留 provider 默认的 `PUBLIC CONNECT`。`template0` 必须继续 `datallowconn = false`；`neondb` 与任何普通数据库不得进入例外。生产 preflight 必须以 Runtime 身份逐库连接，复核 identity、global/session read-only、TLS、login event trigger，以及非系统 Schema/object 的 access 与 ownership；任何 drift 都 fail closed。

该角色不是 PostgreSQL 数据库全局绝对只读证明：`default_transaction_read_only` 可由会话覆盖，`pg_catalog` Large Object 等系统接口仍可能创建调用者拥有的对象。当前正式保证是固定 Web 查询与 HZense 应用 Schema 的最小权限；数据库全局不可写需要 provider 强制只读副本或管理员级系统函数 ACL 的独立门禁。

provider / 集群管理员必须预创建 `hzense_runtime`，固定属性为 `LOGIN NOINHERIT CONNECTION LIMIT 20 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`，并设置 `default_transaction_read_only = on`。数据库 owner 运行 [`configure_runtime_reader.sql`](../db/roles/configure_runtime_reader.sql)，但普通受限 owner 不替另一个角色修改 session 默认值；[`runtime-reader-preflight.mjs`](../packages/database/src/runtime-reader-preflight.mjs) 只验证并 fail closed。

本地与非生产 profile 要求 `hzense_runtime` 没有任何 incoming / outgoing membership。Neon Production profile 只接受唯一一条 provider 管理边：`roleid = hzense_runtime`、`member = neondb_owner`、`grantor = cloud_admin`，并且 `ADMIN = true`、`INHERIT = false`、`SET = false`。它不让 branch owner 继承或切换为 Runtime，也不向 Runtime 传递 owner 权限；`ADMIN = true` 仍允许 branch owner 转授 Runtime 角色，这是被显式接受并在每次生产 preflight 中重新审计的 provider-governance residual。任何额外、反向或 option 漂移的 membership 都 fail closed。

Web 只在 Production 请求时通过 pooled TLS 连接以 `FROM ONLY public.topics` 读取 `runtime_enabled = true` 的 Topic，固定选择上述五列、按 `id` 排序，并使用最大 50 的参数化 `LIMIT`。Preview、CI、构建期与非生产请求不连接数据库。Runtime Reader 的完整部署与健康检查合约见 [ADR 0006](./adr/0006-runtime-reader-boundary.md) 和 [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)。

截至 2026-09-01，代码与 Neon 基础治理已准备：创建了新的七天 provider 回滚分支，设置 `hzense_runtime` 的 read-only session 默认值，撤销未使用 `neondb` 的 ambient database ACL，并在 Neon Tables 用满旧五连接上限后将维护专用 `hzense_migrator` 从 connection limit 5 调整到 10。Migrator 调整不改变 Runtime 权限、其 limit 20 或 Web pool 上限 1。仓库实现已通过 PR #32–#35 合并；目标 `hzense` ACL 的有效权限、直接授权来源和五列 allowlist 已由两组 catalog-only 查询独立复核并保留[脱敏证据](./production-evidence/2026-09-01-runtime-reader-acl.md)。独立 Runtime 凭据、目标/保留库完整生产 preflight、Vercel Production 配置、重部署、健康/真实五列读取与日志验收仍未完成。

---

# 41. 数据一致性规则

必须满足：

1. 所有 ID 唯一。
2. 所有关系 source / target 必须存在。
3. Taxonomy Topic ID 全局唯一，primary parent 由嵌套树唯一派生，跨域关系端点必须存在。
4. Seed Topic 必须属于 Taxonomy，英文规范标题一致，并且只作为运行时启用子集。
5. Topic Markdown 必须属于 Seed，状态一致；每个非 archived Seed Topic 必须恰有一个页面，显式 `parent` 必须等于 Taxonomy primary parent。
6. 所有公开运行时 Topic 引用必须解析到非 archived Seed Topic，包括 published 内容、reviewed / accepted Signal 和 Radar 快照；Topic 内容页不能自行创建 Topic ID。
7. archived 对象不得自动进入新 Daily。
8. rejected、inbox、archived Signal 不得作为 Radar 评分证据。
9. Radar 证据信号必须存在且唯一，关联同一 Topic，发生与采集时间均不晚于快照日期。
10. Signal 原始来源必须使用合法 HTTPS URL，且 hostname 命中 Source 的 `allowed_hosts`。
11. 删除 Entity 优先采用 archived，不做物理删除。
12. Search / Embedding 属于可重建派生数据。
13. Markdown 正文与 PostgreSQL index 通过 public_id 对齐。

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

这套模型作为 HZense v2.0.0 的正式 Evidence Integrity Baseline。
