# 技术洞察信息库 — 设计文档

## Technology Intelligence Hub

**版本：** v1.1  
**日期：** 2026-08-16  
**文档类型：** 产品设计 / 信息架构 / 系统设计 / 实施规划

---

## 1. 项目定位

技术洞察信息库不是传统博客，也不是简单的收藏网站，而是一套面向长期技术研究、信息积累和趋势判断的个人技术情报平台。

核心链路：

> **Signals → Knowledge → Insights → Intelligence**

即：

**信号 → 知识 → 洞察 → 情报**

系统聚合并关联：

- 技术洞察
- 每周好文
- 科技信息解读
- 学术论文
- 公司与产品动态
- 人物与研究机构
- 技术资源
- 融资、并购、招聘
- 政策变化
- 技术信号

---

## 2. 核心能力

### Discover
发现值得关注的文章、论文、产品、公司动态、融资、招聘、政策和技术突破。

### Organize
把碎片信息结构化，统一归入 Topic、Technology、Company、People、Institution、Product、Paper、Event 和 Signal。

### Connect
建立人物、公司、机构、技术、论文、事件和洞察之间的关系，形成 Technology Intelligence Graph。

### Understand
在原始信息之上沉淀自己的技术判断和趋势分析。

### Track
持续跟踪技术热度、成熟度、竞争格局、研究方向、投资趋势、人才流动和政策变化。

---

## 3. 三层信息模型

### Layer 1 — Signals

原始技术信号：

- 新闻
- 新论文
- 产品发布
- 招聘
- 融资
- 收购
- 政策
- GitHub 项目
- 技术突破
- 人员变化

特点：数量多、粒度小、更新快。

### Layer 2 — Knowledge

经过整理后的知识：

- Weekly Picks
- Briefings
- Paper Notes
- Company Profile
- People Profile
- Institution Profile
- Technology Profile
- Resource Collection

特点：结构化、可搜索、可关联。

### Layer 3 — Insights

经过分析形成的判断：

- 技术洞察
- 趋势判断
- 产业分析
- 技术路线
- 专题研究
- 竞争格局

特点：数量较少，但价值最高。

---

## 4. 网站总体信息架构

一级导航：

- **Home** — 技术情报驾驶舱
- **Daily** — 每日技术洞察简报
- **Insights** — 深度技术洞察
- **Topics** — 专题知识库
- **Radar** — 技术雷达
- **Weekly** — 每周好文
- **Resources** — 人物 / 公司 / 机构 / 论文 / 技术
- **Signals** — 最新技术信号
- **Search** — 全库搜索 / AI Search

---

## 5. Home — 技术情报驾驶舱

首页定位为 **Technology Intelligence Dashboard**，主要回答：

1. 最近有什么值得关注？
2. 哪些技术正在发生重要变化？

建议包含：

- This Week
- Technology Radar
- Today's Intelligence / Daily Brief
- Latest Insights
- Latest Signals
- Weekly Picks
- Trending Topics

---

## 6. Daily — 每日技术洞察简报

Daily Intelligence 是整个信息库的高频情报入口，不是简单的每日新闻摘要，而是当天 Signals 经过筛选、去重、关联和研判后形成的每日技术情报产品。

核心生产链：

```text
Sources
  ↓
Signals
  ↓
Daily Intelligence
  ↓
Weekly Intelligence
  ↓
Topics
  ↓
Insights
  ↓
Radar
```

### Daily 页面结构

每日报告建议采用固定结构：

1. **今日必看 Top 5** — 当天最重要的 3–5 个技术事件，并解释为什么重要。
2. **AI & Compute** — 大模型、Agent、AI Infrastructure、GPU、数据中心等。
3. **Cybersecurity** — AI Security、Agent Security、漏洞、安全公司动态等。
4. **Semiconductors** — GPU、HBM、先进封装、光刻、供应链等。
5. **Robotics & Physical AI** — 人形机器人、自动驾驶、具身智能等。
6. **Research Watch** — 当天值得关注的新论文和实验室成果。
7. **Company & Capital** — 融资、并购、产品发布、招聘和重要人员变化。
8. **Signals to Watch** — 暂时尚未成为重大事件，但可能演化为趋势的弱信号。
9. **My Intelligence Take** — 对当天最重要变化的综合研判。
10. **Related Topics** — 自动关联相关 Topic、公司、人物、论文和技术。

### Daily 元数据

建议每份 Daily Brief 使用：

```yaml
---
id: daily-2026-08-16
title: Daily Technology Intelligence — 2026-08-16
date: 2026-08-16
type: daily
status: published
signal_count: 23
major_developments: 8
rising_topics:
  - Agent Security
  - AI Infrastructure
  - Humanoid Robotics
---
```

### Daily 历史归档

```text
Daily
├── 2026
│   ├── August
│   │   ├── 16
│   │   ├── 17
│   │   └── 18
```

首页应突出当天简报，例如：

```text
TODAY'S INTELLIGENCE — AUG 16
8 major developments · 23 signals analyzed · 5 topics rising

Read Daily Brief →
```

Daily 与其他模块的关系：

- **Signals**：原始输入。
- **Daily**：每日筛选与研判。
- **Weekly**：从 7 天 Daily + Signals 中提炼周度趋势。
- **Topics**：把 Daily 中的信息持续沉淀到专题知识库。
- **Insights**：从数周或数月积累中形成深度判断。
- **Radar**：根据长期 Signals、Daily、Weekly 和 Insights 更新趋势判断。

---

## 7. Insights — 技术洞察

用于存放核心研究成果，包括：

- 技术洞察
- 趋势分析
- 产业分析
- 技术路线分析
- 公司分析
- 市场分析
- 专题报告

单篇 Insight 推荐结构：

- Title
- Summary
- Key Takeaways
- My View
- Evidence
- Related Signals
- Related Companies
- Related People
- Related Technologies
- Related Papers
- Timeline
- Sources

其中 **My View** 是最重要的内容。

---

## 8. Topics — 专题知识库

Topic 是整个信息库的核心组织单元。

示例：

```text
Artificial Intelligence
├── Foundation Models
├── AI Agents
├── Agent Security
├── AI Infrastructure
├── AI Safety
└── Physical AI

Cybersecurity
├── Cloud Security
├── Endpoint Security
├── AI Security
├── Identity
└── Zero Trust

Semiconductors
├── GPU
├── HBM
├── Advanced Packaging
└── Lithography

Robotics
├── Humanoid
├── Autonomous Systems
└── Industrial Robotics
```

每个 Topic 页面包含：

- Overview
- My View
- Attention Score
- Trend
- Maturity
- Strategic Value
- Key Problems
- Key Technologies
- Key Players
- Key People
- Important Research
- Recent Signals
- Related Insights
- Timeline

---

## 9. Weekly — 每周好文

每周建立一期 Weekly Picks。

每篇文章保存：

- Title
- Source
- Author
- Date
- URL
- Topic
- Why Read
- Key Points
- My View
- Importance
- Related Topics
- Related Companies
- Related People

Weekly 不只是链接收藏，而是高质量技术知识流。

---

## 10. Briefings — 科技信息解读

用于快速解释新技术或重要事件，目标是：

> **5–10 分钟理解一件事情。**

例如：

- 新模型发布意味着什么？
- NVIDIA 新 GPU 架构解读
- MCP Security 是什么？
- 某公司为什么收购某 Startup？

---

## 11. Signals — 技术信号

Signal 是技术情报系统最小的信息单位。

类型包括：

- Research
- Product
- Funding
- Acquisition
- Hiring
- Policy
- Technology
- Market
- People
- Open Source
- Security
- Patent

示例：

```yaml
date: 2026-08-15
title: Microsoft 扩大 Agent Security 团队
type: hiring
strength: 3
topics:
  - Agent Security
  - AI Security
companies:
  - Microsoft
```

---

## 12. Resources — 技术资源库

核心实体：

1. People
2. Companies
3. Institutions
4. Technologies
5. Products
6. Research / Papers

人物、公司、机构和论文页面均应与 Topic、Signal、Insight 互相关联。

---

## 13. Technology Radar

Radar 是网站核心功能之一。

| Technology | Attention | Trend | Maturity | Strategic Value |
|---|---:|---|---|---|
| AI Agents | 95 | ↑↑ | Emerging | High |
| Agent Security | 88 | ↑↑ | Early | High |
| AI Infrastructure | 91 | ↑ | Growth | High |
| Humanoid Robotics | 82 | ↑↑ | Early | High |
| Quantum Computing | 63 | → | Research | Medium |
| Post-Quantum Crypto | 71 | ↑ | Emerging | High |

指标体系：

**Attention Score：** 0–100

**Trend：**
- ↑↑ Rapid Growth
- ↑ Growth
- → Stable
- ↓ Decline
- ↓↓ Rapid Decline

**Maturity：**
- Research
- Early
- Emerging
- Growth
- Mature

**Strategic Value：**
- Low
- Medium
- High
- Critical

---

## 14. Intelligence Graph

逐步建立技术情报知识图谱。

```text
Person ──works_at──> Company
Company ──develops──> Technology
Technology ──related_to──> Topic
Paper ──researches──> Technology
Signal ──affects──> Topic
Insight ──supported_by──> Signal
```

最终支持从任意 Topic、公司、人物、论文或技术向外探索。

---

## 15. Timeline

Topic、Company、Technology、Person 和 Product 等实体支持时间线。

例如：

```text
AI Agent Security

2025
Agent adoption accelerates
↓
2026 Q1
MCP adoption
↓
2026 Q2
Tool Security
↓
2026 Q3
Runtime Security
↓
2026 Q4
Agent Identity
```

---

## 16. Search 与 Ask Intelligence

全文搜索覆盖：

- Topic
- Insight
- Signal
- Company
- Person
- Institution
- Paper
- Technology

后续增加 **Ask Intelligence**。

例如：

> 最近半年 Agent Security 有什么变化？

系统基于自己的 Insights、Signals、Weekly、Papers、Companies 和 People 回答，并给出信息来源。

---

## 17. 内容存储设计

网站只是 **Presentation Layer**，真正的核心资产是 **Knowledge Base**。

推荐：

> **Markdown + YAML Metadata + Structured Database**

目录结构：

```text
technology-intelligence/
├── content/
│   ├── insights/
│   ├── daily/
│   ├── weekly/
│   ├── briefings/
│   ├── signals/
│   ├── topics/
│   ├── people/
│   ├── companies/
│   ├── institutions/
│   ├── technologies/
│   ├── products/
│   └── papers/
├── data/
│   ├── radar/
│   ├── taxonomy/
│   └── relations/
├── assets/
│   ├── images/
│   ├── logos/
│   └── charts/
├── website/
└── README.md
```

---

## 18. Markdown Metadata 规范

所有内容统一使用 YAML Front Matter。

```yaml
---
id: insight-agent-security-001
title: AI Agent Security
date: 2026-08-16
type: insight
status: published
topics:
  - AI Security
  - Agent Security
technologies:
  - AI Agent
  - MCP
companies:
  - Microsoft
  - OpenAI
importance: 5
trend: rising
---
```

所有对象使用稳定唯一 ID：

```text
topic-agent-security
company-nvidia
person-jensen-huang
paper-2026-agent-security-001
signal-20260816-001
insight-agent-security-001
```

标题变化不能改变 ID。

---

## 19. Taxonomy 分类体系

避免完全依赖自由 Tag。

建议一级领域：

- Artificial Intelligence
- Cybersecurity
- Semiconductors
- Robotics
- Quantum
- Cloud
- Infrastructure
- Autonomous Systems
- Energy Technology
- Space Technology
- Biotechnology

每个领域继续维护受控二级、三级 Topic。

---

## 20. 内容状态与重要度

内容状态：

- Draft
- Review
- Published
- Archived

Topic 状态：

- Watching
- Active
- Strategic
- Archived

重要度采用 1–5 星：

- ★ 普通参考
- ★★ 有价值
- ★★★ 值得持续关注
- ★★★★ 重要
- ★★★★★ 战略级信息

---

## 21. 数据录入工作流

```text
发现信息
   ↓
创建 Signal
   ↓
识别 Topic
   ↓
关联 Company / People / Technology
   ↓
重要信息进入 Weekly
   ↓
需要快速解释 → Briefing
   ↓
多个 Signals 形成趋势
   ↓
形成 Insight
   ↓
更新 Topic
   ↓
更新 Radar
```

---

## 22. AI 辅助处理

AI 可以辅助：

```text
URL
 ↓
读取文章
 ↓
生成摘要
 ↓
识别 Topic
 ↓
识别 Company / People
 ↓
提取 Technology
 ↓
判断 Signal Type
 ↓
推荐 Importance
 ↓
生成实体关联
 ↓
人工审核
```

**My View / 核心技术判断应保留人工确认。**

---

## 23. 视觉与响应式设计

设计方向：

> **SemiAnalysis × Bloomberg Terminal × Notion × Technology Research Institute**

但降低 Bloomberg Terminal 的信息密度。

### PC

主要承担：

- 深度阅读
- 搜索
- Topic 研究
- Intelligence Graph
- Radar
- Timeline

### Mobile

主要承担：

- 阅读
- Weekly
- Signals
- 搜索
- 快速浏览 Topic

响应式断点：

```text
Mobile   < 768px
Tablet   768–1200px
Desktop  > 1200px
```

---

# 23. 项目实施步骤

## Phase 0 — 内容资产盘点与规范确定

### 目标

先建立统一规则，避免建站后再次迁移数据。

### 工作内容

- [ ] 盘点现有技术洞察
- [ ] 盘点每日技术洞察简报
- [ ] 盘点每周好文
- [ ] 盘点科技信息解读
- [ ] 盘点专题研究
- [ ] 盘点人物 / 公司 / 机构资料
- [ ] 确定一级 Taxonomy
- [ ] 确定 Topic 命名规则
- [ ] 确定唯一 ID 规则
- [ ] 确定 Markdown Front Matter Schema
- [ ] 建立目录规范

### 交付物

- `taxonomy.yaml`
- `content-schema.md`
- `directory-structure.md`

---

## Phase 1 — MVP 内容库

### 目标

让已有内容进入统一知识库。

### 实现

- [ ] Markdown 内容仓库
- [ ] Insights
- [ ] Daily
- [ ] Weekly
- [ ] Briefings
- [ ] Topics
- [ ] Signals
- [ ] People
- [ ] Companies
- [ ] Institutions
- [ ] Papers
- [ ] 基础实体关联

### 交付结果

建立独立于网站前端的 **Technology Knowledge Base**。

---

## Phase 2 — 网站 MVP

### 目标

建立可实际使用的 Web 信息库。

### 页面

- [ ] Home
- [ ] Daily 列表 / 日期归档
- [ ] Daily 详情
- [ ] Insight 列表
- [ ] Insight 详情
- [ ] Topic 列表
- [ ] Topic 详情
- [ ] Weekly
- [ ] Resources
- [ ] Signals
- [ ] 全文搜索
- [ ] Mobile / PC 自适应
- [ ] Dark / Light Mode

完成后即可作为日常主要入口。

---

## Phase 3 — Technology Radar

- [ ] Radar 数据模型
- [ ] Attention Score
- [ ] Trend
- [ ] Maturity
- [ ] Strategic Value
- [ ] Radar 历史快照
- [ ] Topic 趋势变化

---

## Phase 4 — Timeline

- [ ] Topic Timeline
- [ ] Company Timeline
- [ ] Technology Timeline
- [ ] Product Timeline
- [ ] 自动从 Signals 生成时间线

---

## Phase 5 — Intelligence Graph

- [ ] Entity Relation Model
- [ ] People ↔ Company
- [ ] Company ↔ Technology
- [ ] Technology ↔ Topic
- [ ] Paper ↔ Researcher
- [ ] Signal ↔ Entity
- [ ] Insight ↔ Evidence
- [ ] Graph Visualization

---

## Phase 6 — AI Knowledge Engine

增加 **Ask Intelligence**：

- [ ] Markdown 内容索引
- [ ] Embedding
- [ ] Vector Search
- [ ] Hybrid Search
- [ ] RAG
- [ ] Source Citation
- [ ] Entity-aware Retrieval
- [ ] Topic-aware Retrieval

目标是让系统能够回答：

> 最近半年我收集的信息中，Agent Security 出现了哪些明显趋势？

并基于自己的知识库给出答案和出处。

---

## Phase 7 — 自动信息采集

接入：

- [ ] RSS
- [ ] arXiv
- [ ] GitHub
- [ ] Technology Blogs
- [ ] Company Blogs
- [ ] Research Institutions
- [ ] Selected Media
- [ ] Newsletters

处理流程：

```text
Source
 ↓
Crawler / RSS
 ↓
AI Classification
 ↓
Entity Extraction
 ↓
Duplicate Detection
 ↓
Importance Ranking
 ↓
Signal Inbox
 ↓
Human Review
 ↓
Knowledge Base
```

---

## Phase 8 — Intelligence Automation

进一步实现：

- [ ] 每日 Signal Digest
- [ ] Daily Intelligence 自动生成候选
- [ ] Daily Brief 人工审核 / 发布流程
- [ ] Weekly Picks 候选生成
- [ ] Topic 自动更新
- [ ] Company 动态追踪
- [ ] People 动态追踪
- [ ] Radar Score 推荐
- [ ] Emerging Topic Detection
- [ ] 异常技术信号发现
- [ ] Weekly Intelligence Report
- [ ] Monthly Technology Review

---

# 24. 推荐实施顺序

```text
1. 内容 Schema
      ↓
2. Markdown Knowledge Base
      ↓
3. Signals
      ↓
4. Daily Intelligence
      ↓
5. 网站 MVP
      ↓
6. Search
      ↓
7. Topic System
      ↓
8. Weekly Intelligence
      ↓
9. Radar
      ↓
10. Timeline
      ↓
11. Intelligence Graph
      ↓
12. AI Search / RAG
      ↓
13. 自动信息采集
      ↓
14. Intelligence Automation
```

核心原则：

> **先把知识结构设计正确，再做复杂功能。**

---

# 25. MVP 完成标准

第一阶段不需要把所有高级功能一次做完。

当以下能力完成，即可认为 MVP 可以投入日常使用：

- 能新增 Markdown 内容
- 能浏览 Insights
- 能浏览每日技术洞察简报及历史归档
- 能浏览 Weekly
- 能浏览 Topics
- 能记录 Signals
- 能管理 People / Companies / Institutions
- 能自动生成关联内容
- 能全文搜索
- 手机与 PC 均可正常使用
- 内容和网站展示层分离
- 新内容可以持续加入而无需重新设计网站

---

# 26. 最终目标

最终系统不应只是“保存我写过什么”，而应该能够回答：

> **我对一个技术方向到底知道什么？**

并进一步回答：

- 这个技术过去一年发生了什么？
- 哪些公司最重要？
- 哪些研究人员值得关注？
- 哪些论文改变了技术路线？
- 哪些早期 Signal 后来成为趋势？
- 我的判断发生过什么变化？
- 哪些技术正在快速升温？
- 哪些新趋势值得继续研究？

最终形成一个持续演化的：

# **Technology Intelligence Platform**

而不是一个静态文章网站。

---

## v1.1 更新记录

- 新增 **Daily / 每日技术洞察简报** 一级模块。
- Daily 成为网站日常最高频情报入口。
- 首页增加 Today's Intelligence。
- 增加 Daily Markdown 元数据与日期归档结构。
- 增加 Daily 自动生成与人工审核流程。
- 更新内容生产链为：
  **Sources → Signals → Daily Intelligence → Weekly Intelligence → Topics → Insights → Radar**
- MVP、目录结构、实施阶段和自动化路线同步加入 Daily。
