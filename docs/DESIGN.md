# HZense — 产品与系统设计文档

## HZense · Technology Intelligence

**版本：** v2.0 设计稿

**日期：** 2026-09-12

**品牌：** HZense  
**品牌定位：** Technology Intelligence  
**品牌标语：** Sense what matters in technology.  
**官方域名：** `hzense.com`  
**Canonical URL：** `https://hzense.com`  
**文档类型：** 产品设计 / 信息架构 / 系统设计 / 实施规划

---

> 本版采用“信号为核心”的新产品方向，详细页面、数据与后台交互见 [HZense v2 重构设计](SIGNAL_FIRST_REDESIGN.md)，采集／导入／模型／任务／发布的必需技术契约见 [AI 自主 Signal 专项设计](AUTONOMOUS_SIGNAL_PIPELINE.md)。两者以初版专项契约 `b5a0045` 为基线整合；设计采纳、应用改版、数据迁移和生产切换分别交付与验收。第 21 节原 MVP 记录是历史交付，不代表新版能力已完成。

## 1. 项目定位

HZense 不是传统博客，也不是简单的收藏网站，而是一套面向长期技术研究、信息积累和趋势判断的个人技术情报平台。

核心链路：

> **来源 → 信号与证据 → 人物／组织 → 趋势、热点与专题洞察**

Signal 是唯一的新增情报事实入口。网站持续发现技术事件、连接业界人物与组织，再基于同一组证据呈现趋势和深入洞察；不再把日报、周报作为独立生产链。

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
  ├── People / Organizations → Resources
  ├── Domain Trends / Hot Signals → Home Radar
  └── Topic Analysis → Versioned Topic Insights
```

事实、关系、分析分层保存；专题洞察的生成次数不会反过来增加 Signal 热度。

## 4. 产品与一级导航

- **雷达（首页）** — 各领域趋势与热点 TOP 10
- **信号** — 事件事实、关键人物、多维聚合与证据
- **专题洞察** — 长期专题与 AI 深度分析的历史版本
- **资源** — 按近期活跃度排序的组织与关联人物，保留其他实体
- **搜索** — 全局工具入口；Ask HZense 是后续能力，不扩充本轮主导航
- **管理后台** — 受保护的 AI、来源、调度、专题运行与审计入口

公众打开网站即可阅读雷达首页，不要求登录；只有管理后台需要认证。

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
https://hzense.com/             雷达首页
https://hzense.com/signals      信号
https://hzense.com/topics       专题洞察
https://hzense.com/resources    资源
https://hzense.com/search       搜索
https://hzense.com/admin        管理后台（需实现与认证）
```

现有站点已使用正式域名；上面的新版页面职责及 `/admin` 是目标设计，不是本次上线状态。旧 `/daily`、`/weekly` 和洞察详情保留兼容档案；`/radar` 在新首页上线后重定向至 `/`。

## 5. Home

首页即雷达。首屏展示各领域趋势、统计窗口与更新时间，随后是最多十条去重热点；每条包含事件时间、人物、组织、评分及“为什么上榜”。补充最新专题洞察和活跃组织，不再用大幅营销介绍或日报占据首屏。

趋势证据不足、来源不可比、任务延迟和少于十条热点均需诚实展示。详细线框与算法见 [重构设计第 3、8 节](SIGNAL_FIRST_REDESIGN.md#3-首页雷达与热点)。

## 6. HZense Daily（历史档案）

新版停止新增 Daily，并退出主导航和内容生产依赖。已有正文、日期与来源不删除，原 URL 保留只读历史标识。

现有定时工作流在新版上线切换阶段明确停用，本次设计不直接关闭工作流或删除脚本。

## 7. 专题洞察：分析内容

Insights 与 Topics 合并。AI 基于已发布且符合证据和人物规则的 Signals 形成深度分析：摘要、主要判断、变化、支持与相反证据、人物／组织、条件性影响和后续观察。每期固定输入版本、模型／配置、截止时间和正文，保留历史版本而不覆盖旧判断。

默认每周运行一次，后台可手动启动；无实质新证据可不生成新一期。自动生成与发表策略独立配置，默认发表策略仍待本轮确认，不在设计阶段开启生产开关。

## 8. 专题洞察：长期专题入口

Topic 是核心组织单元。首批一级领域包括 Artificial Intelligence、Cybersecurity、Semiconductors、Robotics、Quantum、Cloud & Infrastructure、Autonomous Systems、Energy Technology、Space Technology、Biotechnology。

保留 `/topics` 及稳定 Topic ID。专题主页展示最新有效洞察、核心问题、信号时间线、关键人物／组织和历次洞察；固定版本可独立引用。AI 聚类产生的候选专题通过现有 Taxonomy 纳入流程，不每周创建一批重复专题。

## 9. HZense Weekly（历史档案）

新版停止新增 Weekly，保留原页面只读归档。每周执行专题深入分析不等于恢复周报；不再以 Daily 作为洞察输入的必经环节。

## 10. Briefings

既有 Briefing／PaperNote 作为兼容资料保留，不新增一级导航。新事件解读优先进入 Signal 详情，跨事件深入分析进入专题洞察。

## 11. HZense Signals

Signal 是最小情报单元，由 AI 根据后台配置的来源持续采集、去重、提取、核验和研判。自动来源、文档上传和链接提交三种入口默认通过机器规则后自动发布，无必经人工审核；支持显式选择预览及可选人工审核。产品默认不等于生产开关已开启。类型沿用当前模型；事实、解释和预测分开呈现。

每条新版公开 Signal 至少关联一位有证据的业界人物，可关联多人；区分事件参与和组织任职，不能自动挂 CEO 凑数。列表支持时间、领域、趋势、关键词聚合及人物／组织筛选。发生时间不被采集或发表时间替代。

## 12. HZense Resources

资源默认是由已发布 Signals 更新的组织目录，按近期不同事件的时间衰减活跃度排序。组织页展示当前关键人物、职务与依据、任职历史、相关信号和专题洞察。

继续保留 Person、Company、Institution、Technology、Product、Model、Dataset、Standard / Protocol、Paper、Event 及稳定 URL；不因组织成为默认视图而删除其他实体。

Paper 是客观论文实体；HZense 对论文的摘要、解读和判断以 PaperNote 内容独立保存。

## 13. HZense Radar

Radar 并入首页，不再是单独的一级产品。信号热点、领域趋势、组织活跃度分别计算，保存输入、窗口及算法版本；热点不是技术成熟度，组织活跃度不是质量推荐。旧人工快照只作历史资料。

## 14. Intelligence Graph

关系模型示例：Person → works_at → Company；Company → develops → Technology；Model → trained_on → Dataset；Model → evaluated_on → Dataset；Product → uses → Model；Technology → implements → Standard / Protocol；Paper → presented_at → Event；Signal → affects → Topic；Insight → supported_by → Signal。

## 15. Timeline

Topic、Company、Technology、Person、Product、Model 和 Event 支持时间线，并逐步从 Signals 自动生成。

## 16. Search / Ask HZense

默认搜索新版 Signal、专题洞察、组织与人物，并保留其他资源检索；历史日报／周报可通过显式档案选项查询。发表、更正和撤回自动更新搜索，不能再要求逐批手动同步。Ask HZense / Hybrid Retrieval + RAG 保留为后续能力，不作为本轮重构前提。

## 17. 内容与数据原则

目标：新版 Signal、人物／组织、证据、洞察正文版本与运行配置以 PostgreSQL 为权威；Git 保留代码、Taxonomy、迁移、历史档案和导出。搜索、雷达与资源活跃度是可重建投影。正式切换前仍遵循现有读取契约，不能悄悄形成 Seed 与后台双写。

所有对象使用稳定唯一 ID，标题变化不能改变 ID。

## 18. 内容状态与重要度

分别建模处理状态、公开状态与投影状态；`accepted` 等历史值不代表通过新版人物规则。重要度保留 1–5 及理由，但不代替事实证据；发表新版本、撤回和历史归档均留记录。

## 19. AI 自动采集与深入洞察

管理后台配置来源、协议适配器／API 地址、模型列表或手填、分阶段模型与提示词版本、调度、领域、关键词、预算与发表策略。连接测试与 Schema／能力测试分别执行，必要阶段拒绝能力不足模型，支持预配置兼容连接的故障切换。AI 负责采集、人物／组织识别、证据核验、中文研判及周度专题分析；机器不确定时补查／暂缓，不用生成量代替可靠性。

后台增加正式的**资料导入中心**：多选／拖拽上传文档、逐行批量提交超链接，允许混合批次。管理员点击“生成并发布”后触发 AI 提取、去重、核验、人物关联及自动发布；另有“仅生成预览”。缺证据的项目暂缓，合格结果无需逐条再确认；逐项展示状态、费用、Signal 链接，并支持仅重试失败项。文件和批量输入不绕过安全及隐私规则。详见 [批量导入设计](SIGNAL_FIRST_REDESIGN.md#74-文档与超链接批量导入正式功能)。

首版保留初版专项契约的 PDF、DOCX、Markdown、TXT、HTML、CSV／XLSX，以及扫描 PDF、PNG／JPEG OCR；表格与 OCR 不列为可跳过的扩展。保留定位与解析质量门禁，不执行宏、公式或不可信代码。来源支持游标增量采集和机器临时准入；自动扫描原文变化、反证与撤稿并复核，链接失效本身不构成撤回理由。

所有生成先有运行 ID，保存输入与输出版本、证据、模型用量和费用；后台任务不依赖网页保持打开。公众只读保存后的结果，不在访问时付费生成。人工审核作为可选发布策略，与 `auto_publish`／`preview_only` 共用质量规则。

统一发布策略见 [详细设计第 1 节](SIGNAL_FIRST_REDESIGN.md#12-默认值与发布策略)：Signal 默认自动发布已经确定，只有新增的专题洞察默认策略仍待确认。专项设计保留初版契约的完整技术能力，旧 Daily／Weekly 扩展与直接沿用旧信号公开资格的迁移规则由新版取代。服务商配置、密钥管理和付费任务属于独立实施与运行步骤。

## 20. 视觉设计

延续 HZense 深蓝／蓝色品牌和明暗主题。PC 偏趋势与研究工作台，Mobile 偏紧凑热点、信号浏览和阅读；减少大标题及长卡片，清晰区分事实、研判、证据和人物关系。所有图表有文本解释，筛选支持键盘与移动触控。

## 21. 原 MVP 实施记录（历史）

以下复选框保留旧版范围的交付历史；其中 Daily／Weekly 新增生产、独立 Insights／Radar 导航及旧推荐顺序已由本版取代，未勾选项不自动成为新版待办。新版只按第 22 节与详细设计的 V2 阶段推进。

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
- [x] Executable Front Matter Validation
- [x] Physical Database Schema / Migrations
- [x] Repository Skeleton

### Phase 1 — Knowledge Base

- [x] Insights
- [x] Daily
- [x] Weekly
- [ ] Briefings
- [x] Topics
- [x] Signals
- [x] Entities / Relations

### Phase 2 — Website MVP

- [x] Home
- [x] Daily
- [x] Insights
- [x] Topics
- [x] Weekly
- [x] Signals
- [x] Resources
- [x] Search
- [x] Responsive UI
- [x] Dark / Light Mode
- [x] Vercel Deployment
- [x] `hzense.com` DNS / Domain Binding

### Phase 3 — Radar

- [x] Attention / Trend / Maturity / Strategic Value
- [x] Historical snapshots

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

- [x] Daily candidate generation
- [ ] Weekly candidate generation
- [ ] Topic updates
- [ ] Radar recommendations
- [ ] Emerging Topic Detection
- [ ] Weekly / Monthly Intelligence Reports

## 22. 推荐实施顺序

```text
V2-0 设计与发布策略 → V2-1 信号／人物／证据数据契约
→ V2-2 管理后台与 AI 采集 → V2-3 信号探索、资源与自动搜索同步
→ V2-4 雷达首页 → V2-5 周度专题洞察 → V2-6 旧路由归档与上线
```

阶段交付、迁移与验收见 [详细设计第 13 节](SIGNAL_FIRST_REDESIGN.md#13-实施顺序与验收)。不将已完成的旧网站 MVP 百分比用于估算新版完成度。

## 23. 最终目标

HZense 最终不是“保存写过什么”的静态网站，而是能够持续回答：一个技术方向发生了什么、谁最重要、哪些信号正在变成趋势、自己的判断如何变化、下一步值得关注什么。

> **HZense — Sense what matters in technology.**

---

## v2.0 产品方向更新（待实施）

- Signal-first：取消新增日报／周报，雷达作为首页，洞察与专题合并。
- 新版信号必须有有据人物关联；组织资源由已发布信号自动更新和排序。
- 新增管理后台、AI 自动采集、文档／链接批量导入与信号生成发布、周度／手动深入洞察、版本与自动投影更新。
- 保留旧 ID、正文与链接；数据库权威与路由按分阶段验收切换。
- 整合初版专项契约 `b5a0045`：三入口默认自动发布，首版完整文件／OCR、AI 配置、增量来源与自动更正不缩水；历史缺人物内容保留访问但不直接进入新版默认内容集。

## v1.3 域名基线更新（历史）

- 正式主域名锁定为 **hzense.com**。
- Canonical Production URL 锁定为 **https://hzense.com**。
- 产品公共路径统一规划为 `/daily`、`/weekly`、`/signals`、`/insights`、`/topics`、`/radar`、`/resources` 和 `/ask`。
- 首次 MVP 部署后绑定 Vercel，并将 `www.hzense.com` 重定向到根域名。
- 同步更新 Information Model v2.0.0 的证据契约、十类 Entity 表述与项目实施状态。

## v1.2 品牌基线更新

- 正式品牌名锁定为 **HZense**。
- 品牌定位：**Technology Intelligence**。
- 品牌标语：**Sense what matters in technology.**
- 产品模块统一命名为 HZense Daily / Weekly / Signals / Insights / Topics / Radar / Resources / Ask HZense。
- 核心方法论保持：**Signals → Knowledge → Insights → Intelligence**。
