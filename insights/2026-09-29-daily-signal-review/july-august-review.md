# 日报 Signal 复审：2026-07-20—2026-08-31

审读范围：`/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-07-20.md` 至 `ChatGPT每日简报_2026-08-31.md`，共 **38 份实际存在的文件**（8 月 11—14 日、19 日无对应文件）。对照 2026-09-29 当前 `data/seed/signals.yaml`、历史候选 `docs/content-intake/2026-09-11-datas/signals.candidates.yaml` 及一手网页。文件日期是简报日期，以下 Signal `occurred_at` 一律以来源所证实的披露、发布、上市或起诉日期为准。本文不改 Seed，也不表示发布资格已获批准。

## 集成复核结论

- [事实] 下方记录保留研究时的初步判断；最终 11 条候选以 `july-august-candidates.yaml` 为准，仍为 `inbox`。本页的“新增”不代表已入正式 Seed。
- [事实] 动态 IPO 列表不能提供稳定正文，已改用上交所[长鑫静态上市公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260724_10826610.shtml)及[宇树静态上市公告](https://www.sse.com.cn/disclosure/announcement/listing/ipo/c/c_20260818_10829204.shtml)，正文分别明确 7/27、8/19 起交易。价格另交叉核对发行人[长鑫上市公告书](https://static.cninfo.com.cn/finalpage/2026-07-24/1225439534.PDF)及[宇树发行结果](https://static.cninfo.com.cn/finalpage/2026-08-14/1225472623.PDF)，不引用首日涨幅。
- [事实] SoftBank 由初步“待核量化”升级为已读[精确季度财报](https://group.softbank/media/Project/sbg/sbg/pdf/ir/financials/financial_reports/financial-report_q1fy2026_01_en.pdf)：季度内向 OpenAI 投资 100 亿美元、7 月另投 100 亿美元；人物为[官方说明署名 CFO](https://group.softbank/en/news/webcast/20260806_02)。候选只写这些已核内容，不写未逐项核实的净利润、不添加无关半导体标签。
- [推断] 优先级、重要度、可信度和新颖度为编辑判断，结构化包逐项附 `scores_reason`；不是统计测量。人物不足时不补不相关高管，ECB Blog 保留作者观点与机构政策立场的区别。

## 可新增的独立事件

`type` 每条仅一个；`topics` 可多值，采用 `data/taxonomy/taxonomy.yaml` 的 canonical ID。部分 ID 当前尚未投影到 `data/seed/topics.yaml`，入库前须先补 Topic 投影。人物只标原文确有的具体角色；不以媒体署名或公司高管身份推断其主持项目。

| 优先 | 建议事件 / occurred_at / type                                                        | topics                                                                                                       | 组织与人物的有界角色                                                                                                                                                           | 日报位置；首选一手来源；与现有 Seed 的关系                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高   | 台积电 2Q26 会议披露 AI 需求、Arizona 投资计划；**2026-07-16**；`supply_chain`       | `topic-semiconductors`, `topic-foundry`, `topic-advanced-packaging`, `topic-ai-infrastructure`               | TSMC：业绩与投资计划披露方；C. C. Wei：管理层发言人，勿写成 Arizona 所有项目负责人                                                                                             | [7/20 日报:14](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-07-20.md:14)；[台积电 2Q26 电话会原文](https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-07/57b65edbfe6e480e74abe202be983ecbde79e934/TSMC%202Q26%20Transcript.pdf)。日报所引 Reuters 为 7/19 后续报道；不要以 7/19 或 7/20 充当事件日。2650 亿美元是 Arizona **计划投资总额**，不是已投产或当季资本开支。Seed 无对应事件。                                                           |
| 高   | 科技企业发表开放权重 AI 联名政策信；**2026-07-24**；`policy`                         | `topic-foundation-models`, `topic-ai-safety`, `topic-ai-security`                                            | NVIDIA 等：文件列出的签署组织；Jensen Huang：当天公开转发者（若保留人物，须另附其原帖，不标为信件作者）                                                                        | [7/25 日报:14](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-07-25.md:14)；[NVIDIA 托管的联名信 PDF](https://images.nvidia.com/pdf/Open-Weights-and-American-AI-Leadership.pdf)。PDF 首部写 7/24；网页上的签署组织名单持续变化，只能按可追溯版本登记，不回填“原始 25 家”之外的后来签署者。Seed 无对应事件。                                                                                                                                                               |
| 高   | 长鑫科技在上交所科创板上市；**2026-07-27**；`funding`                                | `topic-semiconductors`, `topic-memory`, `topic-dram`, `topic-semiconductor-supply-chain`                     | 长鑫科技：上市主体；上交所：交易场所，非融资投资方；未核实具名人物的事件角色                                                                                                   | [7/27 日报:31](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-07-27.md:31)；[上交所 IPO 上市一览](https://star.sse.com.cn/ipo/listing/)列 688825、发行价 8.66 元、上市日 7/27。日报的“首日涨 466%”为市场价格观察，不宜混入“上市获准”一手事实；若写涨幅须另附交易所行情证据。Seed 已有 `company-cxmt`，无上市 Signal。                                                                                                                                                      |
| 高   | GB 44721-2026《智能网联汽车 自动驾驶系统安全要求》发布；**2026-07-30**；`regulation` | `topic-autonomous-systems`, `topic-ai-safety`（如内容核对后确涉 AI 控制，再加 `topic-physical-ai`）          | 工业和信息化部：归口部门；TC114SC34：执行委员会；孙航等是标准平台列出的“主要起草人”，不是监管发言人                                                                            | [8/09 日报:39](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-09.md:39)；[全国标准信息公共服务平台 GB 44721-2026](https://std.samr.gov.cn/gb/search/gbDetailed?id=Izrd6QbE4dA%3D&mode=p)明确发布日期 7/30、实施日期 2027-07-01。日报 8/07 是报道日期。Seed 无对应事件。                                                                                                                                                                                                 |
| 高   | 中国商务部回应美国 FCC 将外国机器人、逆变器列入覆盖清单；**2026-07-30**；`policy`    | `topic-robotics`, `topic-energy-technology`                                                                  | 中国商务部：回应方；美国 FCC：此前限制措施制定方；回应者仅称“商务部新闻发言人”，无具名人物                                                                                     | [7/30 日报:187](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-07-30.md:187)；[商务部 7/30 原始发布入口](https://video.mofcom.gov.cn/xwfb/2026/7/0d481ba8e61e41beb9e7edd592963871902.html)、[商务部网站全文转载](https://cacs.mofcom.gov.cn/article/gnwjmdt/sb/zm/202607/188785.html)。后者转载页为 7/31，原始发布及同时日报道均指 7/30。Seed 的美国 FCC 规则是另一个事件；本条只记录中方回应，不写成已实施反制。                                                          |
| 高   | Cerebras 发布 CS-4 晶圆级推理系统；**2026-08-18**；`product`                         | `topic-semiconductors`, `topic-ai-accelerators`, `topic-ai-infrastructure`, `topic-inference-infrastructure` | Cerebras：产品发布方；Angela Yeung、Eric Gardner：Cerebras 原文署名作者，不能推断为芯片设计负责人                                                                              | [8/21 日报:47](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-21.md:47)；[Cerebras 8/18 官方发布](https://www.cerebras.ai/blog/introducing-cerebras-cs-4)。首批出货计划为当季，30 倍性能是厂商及特定测试口径。Seed `signal-20260819-semianalysis-cerebras-cs4` 是 **研究文章发布**，与产品发布为两个不同事件，不能把研究信号改写成产品。                                                                                                                                |
| 高   | 宇树科技科创板上市；**2026-08-19**；`funding`                                        | `topic-robotics`, `topic-humanoid-robotics`, `topic-embodied-ai`                                             | 宇树科技：上市主体；上交所：交易场所；王兴兴在 8/20 日报引用的报道中是公司创始人兼 CEO、技术观点发言人，**不是已核实的 IPO 公告发言人**                                        | [8/20 日报:11](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-20.md:11)把“宇树上市后”作为背景；[上交所 IPO 上市一览](https://star.sse.com.cn/ipo/listing/)列 688836、上市日 8/19、发行价 150.80 元。历史 8/05 “保荐机构估值报道”不可当上市事实；这是经新来源定位出的独立事件。Seed 无对应事件。                                                                                                                                                                         |
| 高   | 阿里巴巴完成约 800 亿港元新股配售；**2026-08-26**；`funding`                         | `topic-ai-infrastructure`, `topic-training-infrastructure`, `topic-ai-agents`                                | 阿里巴巴：发行及募资主体；未在公告中发现适合关联的具名业务负责人。IR 联系人不是事件参与者                                                                                      | [8/24 日报:18](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-24.md:18)记录先前配售计划；[阿里巴巴 8/26 完成公告](https://home.alibabagroup.com/en-US/document-2029365886510432256)明确已完成 7.1 亿股、每股 112.70 港元，其中约 60% 拟用于全球计算基础设施，约 40% 拟用于超大 AI 数据中心和 Agentic Cloud 改造。8/23 为拟议与协议、8/24 为定价公告、8/26 为完成，建议只做**一个**配售 Signal，标题用“完成”，事件日取 8/26，摘要交代前阶段。Seed 无对应事件。           |
| 高   | 基隆地检署起诉 9 人涉 B300 服务器不法出口案；**2026-08-24**；`regulation`            | `topic-semiconductors`, `topic-gpu`, `topic-ai-supply-chain-security`, `topic-hardware-security`             | 台湾基隆地方检察署：起诉机关；蕭詠勵：新闻稿列出的指挥侦办检察官；NVIDIA、美超微：新闻稿部分匿名化提及的供应链公司，**不是被起诉的法人**；被告均匿名或遮名，不建立实名人物实体 | [8/25 日报:74](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-25.md:74)；[检方 8/24 新闻稿 PDF](https://www.klc.moj.gov.tw/media/450456/1150824%E5%9F%BA%E6%AA%A2%E5%81%B5%E7%B5%90%E4%B8%8D%E6%B3%95%E5%87%BA%E5%8F%A3%E9%AB%98%E9%9A%8E%E4%BC%BA%E6%9C%8D%E5%99%A8%E6%A1%88%E4%BB%B6%E6%96%B0%E8%81%9E%E7%A8%BF.pdf?mediaDL=true)日期 8/24、起诉 9 人、订单 130 台、检方指称 74 台已转售出口及 56 台未完成出口。写作须用“检方指控”，不写成有罪判决。Seed 无对应事件。 |
| 中   | SoftBank Group 发布 FY2026 Q1 业绩与 AI 投资披露；**2026-08-06**；`market`           | `topic-ai-infrastructure`, `topic-semiconductors`（仅当摘要具体说明 Intel/Arm 股权）                         | SoftBank Group：业绩披露方；Yoshimitsu Goto：官方业绩重点材料署名 CFO                                                                                                          | [8/08 日报:45](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-08.md:45)；[SoftBank 官方业绩与演示材料](https://group.softbank/en/ir/presentations)列 8/06 财报、CFO 说明。入库前以官方报告核对净利润与投资组合数据，避免直接沿用日报/AP 的 3473 亿日元；不把资产重估作为现金收益。Seed 无该季业绩事件。                                                                                                                                                                 |
| 中   | ECB Blog 作者分析 AI 科技股估值及欧元区外溢风险；**2026-08-17**；`research`          | `topic-artificial-intelligence`                                                                              | Malin Andersson、Johannes Breckenfelder、Stefano Corradin、Kalin Nikolov、Maria Antonietta Viola：博客署名研究人员；ECB：刊载平台，博客注明不代表其正式政策立场                | [8/18 日报:136](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-18.md:136)；[ECB Blog 原文](https://www.ecb.europa.eu/press/blog/date/2026/html/ecb.blog20260817~754a8a4418.fi.html)。可记录作者对高估值、欧洲敞口与潜在传导的**研究判断**，不能写成 ECB 预测一定暴跌或正式货币政策。Seed 无对应研究。                                                                                                                                                                   |

## 已有 Seed 的合并与修正建议

1. `signal-20260817-ports-pike-announcement`：8/18 日报 [20 行](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-18.md:20)及 [OpenAI 原文](https://openai.com/index/openai-joins-ports-pike-project/)明确 SB Energy 是 20 年租赁安排下的建设、拥有与运营方，NVIDIA 将投资 15 亿美元并对最初 4.25 IT-GW 的土地、电力、建筑提供信用支持，美国能源部也是合作方。当前 Seed 仅关联 OpenAI 与两名发言人，应补 SB Energy、NVIDIA、美国能源部等**事件角色**和量化摘要；8/16 “NVIDIA 洽谈 SB Energy 投资”以及 7/27、8/15 担保传闻在正式 8/17 公告之后不另造同一交易信号。保留 8GW 为规划容量、2028 年首批 800MW 为计划，勿写成已投运。
2. `signal-20260819-semianalysis-cerebras-cs4`：保留 `research` 单一类型和 SemiAnalysis 分析来源；Cerebras 8/18 产品发布另建 `product` 事件，并通过实体或相关事件链接关联。
3. `signal-20260820-nvidia-china-lpu-denial`：8/21 日报 [24 行](/Users/nanasmac/dev/datas/日报/ChatGPT每日简报_2026-08-21.md:24)已有一条正式 Seed，发言仅否认媒体所述中国特供 LPU；不能从否认推断未来所有 LPU 项目取消。
4. 多条芯片、存储、GPU、代工及先进封装信号应逐条考虑 `topic-semiconductors` 与最细子标签，但不是标题关键词批量添加；已有 topic-ai-infrastructure 可并列。7/27 长鑫上市与 8/29 LPDDR6 量产是不同事件。

## 历史候选 27 条的重新判定

历史候选的 `accepted` 是 9/11 文档提取审核，不是事实核验或网站发布。本表列出本时段原 `seed_promotion.status=deferred` 的全部 27 条；“新增”对应上表，“暂缓”指目前证据不足或事件身份未定，“合并/不入”表示与已有事件重复或不是单一 Signal。

| 日报日期及行 | 线索                                | 本次判定与原因                                                                                                                                                                     |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7/20:14      | TSMC Arizona 与 AI 需求             | **新增**，日期修为 7/16，原始财报电话会可核实                                                                                                                                      |
| 7/20:83      | 中国算力与机器人统计                | **暂缓**，两个统计主题混合，原始披露日期不同                                                                                                                                       |
| 7/22:45      | 中美拟于 9 月 AI 对话               | **暂缓**，媒体称筹备、无正式议程/双方公告；不与 9 月另一轮回应强行合并                                                                                                             |
| 7/25:14      | 开放权重联名信                      | **新增**，7/24 NVIDIA 托管原始 PDF 可核实；固定名单须注意版本                                                                                                                      |
| 7/27:18      | NVIDIA 拟为 OpenAI 融资担保         | **合并/不入**，7 月匿名报道属洽谈；与 8/17 正式 PORTS-Pike 公告核对，仅补正式可证实部分                                                                                            |
| 7/27:31      | 长鑫 IPO                            | **新增**，7/27 上交所上市记录可核实                                                                                                                                                |
| 7/28:100     | 国产浸没 DUV 制造进展               | **暂缓**，缺设备厂商一手里程碑和精确事件日                                                                                                                                         |
| 7/30:187     | 中国商务部回应美国机器人设备限制    | **新增**，商务部官方发布入口 7/30 可核；明确只是回应，非已实施反制                                                                                                                 |
| 8/01:16      | Amazon 完成对 OpenAI 投资           | **暂缓**，日报二手报道与 Amazon 季报未能明确同一笔完成交易的金额、日期；需官方交易披露                                                                                             |
| 8/04:16      | 美国筹备自愿前沿 AI 网络测试        | **暂缓**，尚无可定位的框架正式文本/发布日期；“拟启动”不是已实施                                                                                                                    |
| 8/05:172     | 宇树 IPO 估值报道                   | **合并/不入**，保荐估值报道不是上市事件；另据上交所 8/19 上市建信号                                                                                                                |
| 8/06:16      | Anthropic 定制芯片团队              | **暂缓**，只有 Reuters/BI 引述公司确认，未见可定位 Anthropic 一手公告、具名团队负责人或启动日；如来源证据标准允许 Reuters 直接采访，可建“媒体报道确认组队”，不得写成流片或推出芯片 |
| 8/07:120     | Allianz 旧 IT 退役成本              | **暂缓**，需财报原文区分 AI 转型与一般资产减值，避免混成独立 AI 投资事件                                                                                                           |
| 8/08:45      | SoftBank 季报与 AI 投资             | **中优先候选**，8/06 官方财报存在；量化内容待逐项读原文                                                                                                                            |
| 8/09:15      | 中国 AI 视频融资汇总                | **暂缓**，多家公司多笔融资不能用 8/07 媒体综述日做统一事件日，需拆至各公司公告                                                                                                     |
| 8/09:39      | 自动驾驶系统安全国标                | **新增**，官方标准号 GB 44721-2026，发布日 7/30                                                                                                                                    |
| 8/10:19      | Apple Mac 千问文档与撤下            | **暂缓**，原始 Apple 中文指南一度撤下；不可把旧页面或 Reuters 转述当当前可用产品范围                                                                                               |
| 8/10:33      | AI 专利与先进制造统计               | **暂缓**，指标发布主体、统计期和日期混杂                                                                                                                                           |
| 8/10:47      | SemiAnalysis 对 SpaceX 10GW 的研究  | **暂缓**，原研究中的收入/容量模型有版本冲突；可重写为研究发布，但不可当项目交付                                                                                                    |
| 8/15:16      | NVIDIA 缩减拟议担保                 | **合并/不入**，仍是同一拟议交易的媒体进展；正式 8/17 公告中仅记录已证实信用支持范围                                                                                                |
| 8/16:20      | NVIDIA 洽谈投资 SB Energy           | **合并/不入**，8/17 OpenAI 原文已证实 15 亿美元投资，补既有事件                                                                                                                    |
| 8/18:136     | ECB AI 股估值外溢分析               | **中优先候选**，ECB Blog 8/17 原文、5 位作者均可核；须注明作者观点非 ECB 官方立场                                                                                                  |
| 8/20:11      | 王兴兴世界模型评论                  | **合并/不入**，属于公开观点且 7/22 已有类似讲话；8/20 报道并非独立产品/研究发布，可作为机器人领域背景；同日报隐含的宇树 8/19 上市另建信号                                          |
| 8/24:16      | 阿里巴巴 AI 新股配售                | **新增**，以 8/26 完成公告为单一事件，一并交代 8/23/24 阶段                                                                                                                        |
| 8/25:74      | 台湾 B300 服务器案                  | **新增**，检方 8/24 原始 PDF 可核实；保留“指控/起诉”诉讼阶段                                                                                                                       |
| 8/26:133     | 工信部 AI 标准化与 6G               | **暂缓**，两个主题混合，需定位具体原始会议/政策文件及各自日期                                                                                                                      |
| 8/30:27      | Cursor/Anthropic 对模型供应变化回应 | **暂缓**，先核实各自声明及供应范围；现有 Seed 已记录 OpenAI 决策，不能据转述推断 Anthropic 的新增供给合同                                                                          |

## 逐文件覆盖清单

“已有”表示至少一条主线在当前 Seed 中有明确对应 Signal；“新增”与“暂缓”指本轮额外决定。财经、国际、宏观章节只有在涉及 AI、半导体、机器人或其直接基础设施规则时纳入 Signal 判定。

| 文件日期 | 判定                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 7/20     | 新增 TSMC；算力/机器人合并统计暂缓；一般市场波动不单立事件                |
| 7/21     | 已有 Kimi 订阅暂停、Hut 8 租约                                            |
| 7/22     | 已有 OpenAI/Hugging Face 安全事故；中美会谈筹备暂缓                       |
| 7/23     | 已有 Alphabet Q2、AMD–Anthropic 合作                                      |
| 7/24     | 已有 Intel Q2、美国数据中心电费承诺                                       |
| 7/25     | 新增开放权重联名信；已有 AI Kill Switch 提案                              |
| 7/26     | 已有 NVIDIA–SK、Samsung–Broadcom 合作                                     |
| 7/27     | 新增长鑫上市；NVIDIA 担保匿名洽谈与 8/17 公告合并                         |
| 7/28     | 已有蒸馏争议政策回应；DUV 设备报道暂缓；芯片股波动不是独立技术事件        |
| 7/29     | 已有 SK hynix 财报、美国机器人/逆变器限制等                               |
| 7/30     | 已有 Microsoft、Meta 财报、德国 AI 监管、AI+ 政策；新增商务部回应         |
| 7/31     | 已有 Amazon Q2；Apple 财报一般性回顾不新增                                |
| 8/01     | 已有模块化数据中心研究；Amazon–OpenAI 投资完成待核实                      |
| 8/02     | 已有欧盟 AI 透明度、模块化数据中心研究；背景重复不新增                    |
| 8/03     | 已有集成电路布图条例、欧盟 AI 透明度；背景重复不新增                      |
| 8/04     | 已有 Kimi K3 架构研究；美国自愿网络测试框架暂缓                           |
| 8/05     | 已有英国 AISI 评估、AMD 财报；宇树估值报道不入，后有真实上市              |
| 8/06     | 已有 Kimi K3 研究；Anthropic 自研芯片团队暂缓                             |
| 8/07     | 已有 AMD–Taalas 收购、AMD 生态研究；Allianz IT 成本待核实                 |
| 8/08     | 已有 Intel Q2、数据中心延期口径研究；SoftBank Q1 中优先候选               |
| 8/09     | 新增自动驾驶安全国标；视频融资集合须拆、数据中心旧研究已有                |
| 8/10     | Apple–Qwen 产品状态、AI 专利统计和 SpaceX 10GW 研究均暂缓                 |
| 8/15     | 已有低延迟推理研究；NVIDIA 担保修订传闻不单入                             |
| 8/16     | 已有 TileRT 研究；NVIDIA–SB Energy 洽谈与 8/17 公告合并                   |
| 8/17     | 已有 PJM 电力研究；融资与市场概述不另立                                   |
| 8/18     | 已有 PORTS-Pike 合作；补实体/摘要；ECB 分析为中优先候选                   |
| 8/20     | 已有 TileRT 研究；另据交易所新增宇树 8/19 上市，CEO 观点作背景            |
| 8/21     | 已有 NVIDIA LPU 否认、SemiAnalysis CS-4 研究；新增 8/18 Cerebras 产品发布 |
| 8/22     | 已有 NVIDIA–Cloverleaf 投资、电网约束研究                                 |
| 8/23     | 已有 NVIDIA 服务器涨价报道、开放模型研究                                  |
| 8/24     | 新增阿里巴巴配售；已有 AgentX/InferenceXv3 研究                           |
| 8/25     | 新增台湾 B300 起诉；已有开放模型研究                                      |
| 8/26     | 已有 Jalapeño 首批结果/研究；工信部 AI 与 6G 混合陈述暂缓                 |
| 8/27     | 已有 NVIDIA 2027 财年 Q2 业绩及相关研究                                   |
| 8/28     | 已有 SK hynix 美国封装基地、机器人产业政策、PJM 研究                      |
| 8/29     | 已有 OpenAI–Cursor 决策、长鑫 LPDDR6、GCP 研究；Cursor/Anthropic 回应暂缓 |
| 8/30     | 已有国家智算规模、OpenAI–Cursor 与 SemiAnalysis 研究；重复报道不新增      |
| 8/31     | 已有 FSB 前沿 AI 网络风险函、Neocloud 安全研究                            |

## 风险与可能错处

- 日报不是原始证据。TSMC、长鑫、GB 国标与 Alibaba 的日报日期或报道日期均晚于真实事件；部分简报复述跨日背景，不能靠标题批量产生 Signal。
- NVIDIA 联名信 PDF 的签署者名单后来扩张，当前版本不能证明每家公司均在 7/24 原始 25 家内；本轮不登记完整签署者实体清单。
- 台湾检方新闻稿是侦查机关指控；人物姓名被遮盖，不能以媒体猜测补全，也不能把 NVIDIA、美超微列为被起诉公司。
- 新候选大多没有证实的具名人物。若某发布路径强制人物字段，应暂停该路径或在来源中核实名确切角色；不能塞入媒体记者、IR 联系人或不相关高管。
- 上表是事件身份与来源复审，不含重要度、可信度、新颖度数值校准，也没有授权生产发表。
